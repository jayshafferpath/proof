#!/usr/bin/env node
/**
 * The derivation layer behind /proof:decision-log (skills/decision-log/SKILL.md).
 * ledger-cli.js takes a fully-formed event and owns the bookkeeping that must
 * not be hand-computed (seq, id, supersedes, the schema gate); this owns the
 * bookkeeping an agent shouldn't have to restate on every call — which ticket,
 * which phase, one flag per anchor instead of a JSON blob — so a call reads
 * close to the judgment it's recording and nothing else.
 *
 * Ticket and phase are sticky in .proof/state.json: set once (--ticket,
 * --phase), reused on every later call for this ticket until overridden.
 * Ledger defaults to .proof/ledgers/<ticket>.ledger.jsonl (generator/ledger-
 * paths.js) — one file per initiative/PR, not one growing file per repo, so
 * a ticket's ledger stays small enough to review and commit alongside that
 * PR's own diff (docs/ledger-schema.md). Pass --ledger to override.
 *
 * This tool never sets `observedAt` and never accepts `--by human`. Both are
 * exactly the laundering the ladder exists to prevent — see
 * docs/ledger-schema.md "Provenance" and "Human attestation". `observedAt` is
 * evidence a hook records at edit time (.plans/live-decision-capture.md Phase
 * 3); a CLI stamping it at write time would make every event's `commit` trivially
 * equal its own `observedAt`, which isn't evidence, it's the same assertion
 * wearing a second field. Until that hook exists, every event this tool writes
 * honestly reduces to `reconstructed` (see reduce-ledger.js's signalOf) — real,
 * not a bug, and not this tool's to paper over.
 *
 * A human confirming a plan or verifying realized code runs `ledger-cli.js
 * human-attest` themselves, then `verify`/`confirm` here with --by human — a
 * deliberate escape hatch for a human at their own keyboard, not for the skill.
 *
 * CLI:
 *   decision-log.js propose --title <t> --chose <c> --rejected <r> --why <w>
 *                            [--id dN] [--ac a,b,c] [--ticket t] [--phase p]
 *   decision-log.js realize <id> [--title ...] [--chose ...] [--rejected ...]
 *                            [--why ...] [--anchor file:lines[:hlLo-hlHi][:context]]...
 *                            [--test file:name]...
 *   decision-log.js revise  <id> --reason <r> [--supersedes idN@seqM] [content/evidence flags as realize]
 *   decision-log.js reject  --title <t> --chose <c> --rejected <r> --why <w> --reason <r> [--id rN]
 *   decision-log.js verify  <id> --reason <r> [--by human]
 *   decision-log.js confirm <id> --reason <r> [--by human]
 *   decision-log.js close   --reason <r>
 *
 * Every subcommand accepts [--ticket t] [--phase p] [--ledger path] [--state path].
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { appendEvent } = require("./ledger-cli");
const { ledgerPath: ledgerPathForTicket } = require("./ledger-paths");

const PHASES = ["plan", "execute", "review", "copilot"];
const ID_EVENTS = ["realize", "revise", "verify", "confirm"]; // take a positional <id>

function defaultStatePath() {
  return path.join(process.cwd(), ".proof", "state.json");
}

function readState(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}
function writeState(p, state) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(state, null, 2) + "\n");
}

function currentBranch() {
  try {
    return execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

// The commit an anchor's line range was drawn against — not a claim about
// when the work happened (that's observedAt, which this tool never sets),
// just enough for a later reader to know which version of the file "lines
// 10-14" refers to. Without this, a superseded anchor retired into history
// (reduce-ledger.js's foldDecision) is unlabeled: a reader can tell it's old
// but not old *as of what*.
function gitHead() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

// A Jira-style key at the start of the branch name ("NEV-1645-add-x" -> "NEV-1645");
// falls back to the whole branch name for repos that don't name branches that way.
function deriveTicketFromBranch(branch) {
  const m = branch.match(/^[A-Z][A-Z0-9]*-\d+/);
  return m ? m[0] : branch;
}

function resolveTicket(a, state) {
  if (a.ticket) return a.ticket;
  if (state.ticket) return state.ticket;
  const branch = currentBranch();
  if (!branch) {
    throw new Error(
      "no --ticket given, none in .proof/state.json, and no current git branch to derive one from",
    );
  }
  return deriveTicketFromBranch(branch);
}

function resolvePhase(a, state) {
  if (a.phase) {
    if (!PHASES.includes(a.phase)) throw new Error(`--phase must be one of ${PHASES.join(", ")}`);
    return a.phase;
  }
  if (state.phase) return state.phase;
  throw new Error(
    `no phase set — pass --phase on the first call for this ticket (${PHASES.join("|")})`,
  );
}

// "src/x.ts:10-14" | "src/x.ts:10-14:12-13" | "src/x.ts:10-14:context" |
// "src/x.ts:10-14:12-13:context" | "src/x.ts:~" (scoping call, no code)
function parseAnchor(spec, opts) {
  const [file, lines, ...rest] = spec.split(":");
  if (!file || lines === undefined) {
    throw new Error(`--anchor "${spec}" must be file:lines[:hlLo-hlHi][:context]`);
  }
  const anchor = { file, lines, role: opts.role || "anchor" };
  for (const tok of rest) {
    if (tok === "context") anchor.context = true;
    else {
      const m = tok.match(/^(\d+)-(\d+)$/);
      if (m) anchor.hl = [+m[1], +m[2]];
    }
  }
  if (opts.divergeAt && anchor.role === "divergence") anchor.divergeAt = opts.divergeAt;
  if (opts.sha) anchor.sha = opts.sha;
  return anchor;
}

function parseTest(spec) {
  const i = spec.indexOf(":");
  if (i === -1) throw new Error(`--test "${spec}" must be file:name`);
  return { file: spec.slice(0, i), name: spec.slice(i + 1) };
}

// Repeatable (--anchor, --test) and single-value flags, plus a leading
// positional <id> for the events that take one.
function parseArgs(argv, opts = {}) {
  const a = { anchors: [], tests: [] };
  let rest = argv;
  if (opts.takesId) {
    if (!rest.length || rest[0].startsWith("--")) {
      throw new Error(`${opts.event} requires a decision id as its first argument`);
    }
    a.id = rest[0];
    rest = rest.slice(1);
  }
  for (let i = 0; i < rest.length; i++) {
    const tok = rest[i];
    if (!tok.startsWith("--")) throw new Error(`unexpected argument "${tok}"`);
    const key = tok.slice(2);
    const val = rest[++i];
    if (key === "anchor") a.anchors.push(val);
    else if (key === "test") a.tests.push(val);
    else a[key] = val;
  }
  return a;
}

function buildEvent(event, a, ticket, phase) {
  const ev = { event, ticket, phase, by: a.by === "human" ? "human" : "agent" };
  if (a.id) ev.id = a.id;
  if (a.title) ev.title = a.title;
  if (a.chose) ev.chose = a.chose;
  if (a.rejected) ev.rejected = a.rejected;
  if (a.why) ev.why = a.why;
  if (a.ac) ev.ac = a.ac.split(",").map((s) => s.trim()).filter(Boolean);
  if (a.reason) ev.reason = a.reason;
  if (a.supersedes) ev.supersedes = a.supersedes;
  if (a.anchors.length) {
    const sha = gitHead();
    ev.anchors = a.anchors.map((s) => parseAnchor(s, { role: a.role, divergeAt: a["diverge-at"], sha }));
  }
  if (a.tests.length) ev.tests = a.tests.map(parseTest);
  return ev;
}

const REQUIRES = {
  propose: ["title", "chose", "rejected", "why"],
  reject: ["title", "chose", "rejected", "why", "reason"],
  revise: ["reason"],
  verify: ["reason"],
  confirm: ["reason"],
  close: ["reason"],
  realize: [],
};

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || !(cmd in REQUIRES)) {
    console.error(
      "usage: decision-log.js <propose|realize|revise|reject|verify|confirm|close> ...\n" +
        "  see the header of generator/decision-log.js for each subcommand's flags",
    );
    process.exit(2);
  }

  try {
    const a = parseArgs(rest, { takesId: ID_EVENTS.includes(cmd), event: cmd });
    for (const field of REQUIRES[cmd]) {
      if (!a[field]) throw new Error(`${cmd} requires --${field}`);
    }
    if (a.by && a.by !== "human" && a.by !== "agent") {
      throw new Error(`--by must be "human" (a human, at their own keyboard) or omitted`);
    }
    if (a.by === "human" && !["verify", "confirm"].includes(cmd)) {
      throw new Error(`--by human only applies to verify/confirm`);
    }

    const statePath = a.state || defaultStatePath();
    const state = readState(statePath);
    const ticket = resolveTicket(a, state);
    const phase = resolvePhase(a, state);
    writeState(statePath, { ...state, ticket, phase });
    const ledgerPath = a.ledger || ledgerPathForTicket(process.cwd(), ticket);

    const event = buildEvent(cmd, a, ticket, phase);
    const written = appendEvent(ledgerPath, event, { attestPath: a["attest-path"] });
    console.log(JSON.stringify(written));
  } catch (e) {
    console.error(`decision-log error: ${e.message}`);
    process.exit(1);
  }
}

if (require.main === module) main();
module.exports = { resolveTicket, resolvePhase, deriveTicketFromBranch, parseAnchor, parseTest, buildEvent };
