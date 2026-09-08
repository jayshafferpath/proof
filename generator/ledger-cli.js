#!/usr/bin/env node
/**
 * Deterministic writer for a proof.ledger/v1 log. Callers supply an event's
 * semantics (title/why/anchors/…); this module owns the bookkeeping that must
 * not be hand-computed: monotonic seq, id minting/reference-checking, commit
 * stamping, supersedes resolution, and the schema gate. A schema-invalid or
 * dangling event is never appended.
 *
 * Shared by the Tier-1 retrofit reducer and the Tier-3 live /proof:decision-log
 * skill (skills/decision-log/SKILL.md, generator/decision-log.js).
 *
 * CLI:  node ledger-cli.js append --ledger <path> [--commit <sha>] --event '<json>'
 *       node ledger-cli.js human-attest --ticket <t> [--kind confirm|verify|any] [--commit <sha>]
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { check } = require("./schema-check");

const LEDGER_SCHEMA = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "schemas", "ledger.v1.schema.json"), "utf8"),
);
const HEADER = { contract: "proof.ledger/v1" };
const ATTESTS = ["confirm", "verify"]; // pure attestation — must reference an existing decision
const ESTABLISHES = ["realize", "revise"]; // may reference OR first-establish a decision (if it carries a title)

// `by: "human"` on these two events is what the provenance ladder pays out on
// (author-confirmed, author-verified — see reduce-ledger.js). Schema alone
// can't stop an agent from just writing `"by":"human"` in the same call that
// writes everything else, so a human claim on either event must be grounded in
// a *separate* attestation record — evidence of a real human action, not an
// assertion bundled into the thing it's attesting to. Until a hook (Phase 3 of
// .plans/live-decision-capture.md) writes that record automatically, a human
// runs `human-attest` themselves, in their own turn, before the agent's
// `append` call — which is the whole point: the two can't be the same action.
const NEEDS_HUMAN_ATTEST = ["confirm", "verify"];

function defaultAttestPath() {
  return path.join(process.cwd(), ".proof", "human-attest.jsonl");
}

function readAttestations(p) {
  return fs.existsSync(p)
    ? fs.readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l))
    : [];
}

function writeAttestations(p, records) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, records.map((r) => JSON.stringify(r)).join("\n") + (records.length ? "\n" : ""));
}

// One attestation authorizes exactly one event: consumed on match, so a single
// plan approval can't silently cover every verify that comes after it.
function consumeHumanAttestation(attestPath, ticket, kind) {
  const records = readAttestations(attestPath);
  const idx = records.findIndex((r) => r.ticket === ticket && (r.kind === kind || r.kind === "any"));
  if (idx === -1) {
    throw new Error(
      `by:"human" ${kind} for ticket "${ticket}" has no matching attestation — a human runs: ` +
        `node ledger-cli.js human-attest --ticket ${ticket} --kind ${kind}`,
    );
  }
  records.splice(idx, 1);
  writeAttestations(attestPath, records);
}

function recordHumanAttestation(attestPath, { ticket, kind, commit }) {
  const records = readAttestations(attestPath);
  records.push({ ticket, kind, commit, ts: new Date().toISOString() });
  writeAttestations(attestPath, records);
}

const readLines = (p) =>
  fs.existsSync(p)
    ? fs.readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l))
    : [];
const events = (lines) => lines.filter((l) => l.event);

function nextSeq(lines) {
  const seqs = events(lines).map((e) => e.seq);
  return seqs.length ? Math.max(...seqs) + 1 : 1;
}

function nextId(lines, prefix) {
  const ns = events(lines)
    .map((e) => e.id)
    .filter((id) => id && id.startsWith(prefix))
    .map((id) => Number(id.slice(prefix.length)))
    .filter(Number.isFinite);
  return prefix + ((ns.length ? Math.max(...ns) : 0) + 1);
}

function lastSeqOfId(lines, id) {
  const e = events(lines).filter((x) => x.id === id);
  return e.length ? e[e.length - 1].seq : null;
}

function gitHead(dir) {
  try {
    // stdio: an unborn HEAD (no commit yet) makes `rev-parse` fail with
    // "fatal: Needed a single revision" on stderr — a real, unremarkable case
    // (working before a repo's first commit), not something worth leaking to
    // the terminal on the way to the same "0000000" fallback below.
    return execFileSync("git", ["-C", dir, "rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "0000000";
  }
}

function nearestExistingDir(dir) {
  let d = path.resolve(dir);
  while (!fs.existsSync(d)) {
    const parent = path.dirname(d);
    if (parent === d) return d; // reached filesystem root without finding one
    d = parent;
  }
  return d;
}

// Append one event, resolving all bookkeeping. Returns the written event so the
// caller learns the minted id / assigned seq. Throws (never appends) on a
// dangling reference or a schema violation.
function appendEvent(ledgerPath, ev, opts = {}) {
  const lines = readLines(ledgerPath);
  const out = { ...ev };

  if (out.event === "propose" && !out.id) out.id = nextId(lines, "d");
  if (out.event === "reject" && !out.id) out.id = nextId(lines, "r");

  const known = out.id && events(lines).some((e) => e.id === out.id);
  if (ATTESTS.includes(out.event)) {
    if (!out.id) throw new Error(`${out.event} requires an id`);
    if (!known) throw new Error(`${out.event} references unknown decision "${out.id}"`);
  }
  if (ESTABLISHES.includes(out.event)) {
    if (!out.id) throw new Error(`${out.event} requires an id`);
    // A realize/revise may be a decision's first appearance (discovered during
    // execution) only if it carries the content to stand on its own.
    if (!known && !out.title) {
      throw new Error(`${out.event} "${out.id}" is unknown and carries no title to establish it`);
    }
  }
  if (out.event === "verify") {
    const realized = events(lines).some(
      (e) => e.id === out.id && (e.event === "realize" || e.event === "revise"),
    );
    if (!realized) throw new Error(`verify "${out.id}" has no prior realize/revise to verify`);
  }
  if (out.by === "human" && NEEDS_HUMAN_ATTEST.includes(out.event)) {
    consumeHumanAttestation(opts.attestPath || defaultAttestPath(), out.ticket, out.event);
  }
  if (out.event === "revise" && !out.supersedes) {
    const s = lastSeqOfId(lines, out.id);
    if (s != null) out.supersedes = `${out.id}@seq${s}`;
  }

  out.seq = nextSeq(lines);
  // git -C <dir> needs `dir` to exist on disk. Ledgers now nest under
  // .proof/ledgers/ (one file per ticket), which doesn't exist yet on a
  // ticket's first event — walk up to the nearest ancestor that does exist
  // rather than mkdir this early, so a schema-invalid event (thrown below,
  // never appended) doesn't still leave an empty directory behind.
  if (!out.commit) out.commit = opts.commit || gitHead(nearestExistingDir(path.dirname(ledgerPath)));

  const errs = check(LEDGER_SCHEMA, out);
  if (errs.length) {
    throw new Error(`schema: ${errs.map((e) => `${e.path} — ${e.message}`).join("; ")}`);
  }

  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  const prefix = lines.length ? "" : JSON.stringify(HEADER) + "\n";
  fs.appendFileSync(ledgerPath, prefix + JSON.stringify(out) + "\n");
  return out;
}

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i += 2) a[argv[i].replace(/^--/, "")] = argv[i + 1];
  return a;
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const a = parseArgs(rest);

  if (cmd === "human-attest") {
    if (!a.ticket) {
      console.error("usage: ledger-cli.js human-attest --ticket <t> [--kind confirm|verify|any] [--commit <sha>]");
      process.exit(2);
    }
    const kind = a.kind || "any";
    if (!["confirm", "verify", "any"].includes(kind)) {
      console.error(`--kind must be confirm, verify, or any (got "${kind}")`);
      process.exit(2);
    }
    const attestPath = a["attest-path"] || defaultAttestPath();
    recordHumanAttestation(attestPath, { ticket: a.ticket, kind, commit: a.commit || gitHead(process.cwd()) });
    console.log(`recorded: a human attests "${kind}" for ticket "${a.ticket}" (${attestPath})`);
    return;
  }

  if (cmd !== "append") {
    console.error(
      "usage: ledger-cli.js append --ledger <path> [--commit <sha>] --event '<json>'\n" +
        "       ledger-cli.js human-attest --ticket <t> [--kind confirm|verify|any] [--commit <sha>]",
    );
    process.exit(2);
  }
  if (!a.ledger || !a.event) {
    console.error("append requires --ledger and --event '<json>'");
    process.exit(2);
  }
  try {
    const written = appendEvent(a.ledger, JSON.parse(a.event), {
      commit: a.commit,
      attestPath: a["attest-path"],
    });
    console.log(JSON.stringify(written));
  } catch (e) {
    console.error(`ledger error: ${e.message}`);
    process.exit(1);
  }
}

if (require.main === module) main();
module.exports = {
  appendEvent,
  readLines,
  events,
  nextSeq,
  nextId,
  recordHumanAttestation,
  consumeHumanAttestation,
  defaultAttestPath,
};
