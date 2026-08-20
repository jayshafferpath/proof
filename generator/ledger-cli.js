#!/usr/bin/env node
/**
 * Deterministic writer for a proof.ledger/v1 log. Callers supply an event's
 * semantics (title/why/anchors/…); this module owns the bookkeeping that must
 * not be hand-computed: monotonic seq, id minting/reference-checking, commit
 * stamping, supersedes resolution, and the schema gate. A schema-invalid or
 * dangling event is never appended.
 *
 * Shared by the Tier-1 retrofit reducer and the Tier-3 live /decision-log skill.
 *
 * CLI:  node ledger-cli.js append --ledger <path> [--commit <sha>] --event '<json>'
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
    return execFileSync("git", ["-C", dir, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "0000000";
  }
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
  if (out.event === "revise" && !out.supersedes) {
    const s = lastSeqOfId(lines, out.id);
    if (s != null) out.supersedes = `${out.id}@seq${s}`;
  }

  out.seq = nextSeq(lines);
  if (!out.commit) out.commit = opts.commit || gitHead(path.dirname(ledgerPath));

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
  if (cmd !== "append") {
    console.error("usage: ledger-cli.js append --ledger <path> [--commit <sha>] --event '<json>'");
    process.exit(2);
  }
  const a = parseArgs(rest);
  if (!a.ledger || !a.event) {
    console.error("append requires --ledger and --event '<json>'");
    process.exit(2);
  }
  try {
    const written = appendEvent(a.ledger, JSON.parse(a.event), { commit: a.commit });
    console.log(JSON.stringify(written));
  } catch (e) {
    console.error(`ledger error: ${e.message}`);
    process.exit(1);
  }
}

if (require.main === module) main();
module.exports = { appendEvent, readLines, events, nextSeq, nextId };
