#!/usr/bin/env node
/**
 * Stop hook — Phase 3 of .plans/live-decision-capture.md. Blocks stopping
 * while a ticket has decisions that were proposed but never given a
 * terminal event (realize/revise/reject), and tells the agent which ids are
 * still open. This is what makes deviation capture reliable: the agent
 * reconciles against a known list instead of free-associating about what
 * was worth logging.
 *
 * Ledgers are one-per-ticket (generator/ledger-paths.js), so this resolves
 * the same current-ticket a decision-log.js call would (sticky
 * .proof/state.json, else the branch name) and checks only that ticket's
 * file — reconciling against the initiative actually in flight, not
 * everything any ticket ever left open in this repo. If no ticket can be
 * resolved (no state, no branch), it falls back to scanning every ledger
 * under .proof/ledgers/ rather than silently skipping a real open decision.
 *
 * Two guards, both load-bearing:
 *
 * 1. Inert with no ledgers. If .proof/ledgers/ doesn't exist for this
 *    project, exit 0 immediately — every repo that hasn't opted into live
 *    capture is completely unaffected.
 *
 * 2. A self-built re-entrancy cap. Whether this Claude Code install
 *    provides a documented "stop_hook_active"-style field to detect a
 *    hook re-triggering itself was NOT confirmed in this session (the
 *    bundled settings schema didn't show one, and external research gave
 *    conflicting answers). Rather than trust an unconfirmed field, this
 *    hook counts its own consecutive blocks for the *same* open-id set in
 *    a small state file and gives up (exits 0, fails open) after
 *    MAX_CONSECUTIVE_BLOCKS. An agent that is never going to resolve the
 *    open decisions this session must always have a way to actually stop.
 *
 * Blocks via `decision: "block"` + `reason` — documented for Stop hooks by
 * this install's own settings schema (the "continueLoop" field an earlier,
 * unverified research pass suggested does not appear there and is not used).
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { readLines, events } = require("../generator/ledger-cli");
const { ledgerPath: ledgerPathForTicket, ledgerDir } = require("../generator/ledger-paths");

const MAX_CONSECUTIVE_BLOCKS = 3;
const TERMINAL = ["realize", "revise", "reject"];

function readStdin() {
  return fs.readFileSync(0, "utf8");
}

// Same rule as generator/decision-log.js's resolveTicket/deriveTicketFromBranch
// (duplicated rather than imported — see hooks/record-approval.js, which
// duplicates it for the same reason: a hook shouldn't depend on decision-log.js's
// CLI-parsing internals just to reuse two small pure functions).
function deriveTicketFromBranch(branch) {
  const m = branch.match(/^[A-Z][A-Z0-9]*-\d+/);
  return m ? m[0] : branch;
}

function currentTicket(cwd) {
  try {
    const state = JSON.parse(fs.readFileSync(path.join(cwd, ".proof", "state.json"), "utf8"));
    if (state.ticket) return state.ticket;
  } catch {
    // no sticky state — fall through to the branch
  }
  try {
    const branch = execFileSync("git", ["-C", cwd, "branch", "--show-current"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return branch ? deriveTicketFromBranch(branch) : null;
  } catch {
    return null;
  }
}

// Fallback when no ticket can be resolved at all: check every ledger under
// .proof/ledgers/ rather than silently skip a real open decision.
function allLedgerPaths(cwd) {
  const dir = ledgerDir(cwd);
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".ledger.jsonl"))
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

function openIds(lines) {
  const evs = events(lines);
  const byId = new Map();
  for (const e of evs) {
    if (!e.id) continue;
    if (!byId.has(e.id)) byId.set(e.id, []);
    byId.get(e.id).push(e.event);
  }
  const open = [];
  for (const [id, kinds] of byId) {
    const hasPropose = kinds.includes("propose");
    const hasTerminal = kinds.some((k) => TERMINAL.includes(k));
    if (hasPropose && !hasTerminal) open.push(id);
  }
  return open.sort();
}

function main() {
  let input = {};
  try {
    input = JSON.parse(readStdin());
  } catch {
    // proceed with an empty input rather than bail — cwd fallback below
    // still lets the ledger check run
  }
  const cwd = input.cwd || process.cwd();
  if (!fs.existsSync(ledgerDir(cwd))) return; // guard 1: not opted in

  const ticket = currentTicket(cwd);
  const paths = ticket ? [ledgerPathForTicket(cwd, ticket)] : allLedgerPaths(cwd);
  if (!paths.length) return;

  const multi = paths.length > 1;
  const open = [];
  for (const p of paths) {
    if (!fs.existsSync(p)) continue; // this ticket's ledger doesn't exist yet
    let lines;
    try {
      lines = readLines(p);
    } catch {
      continue; // an unreadable ledger is not this hook's problem to fix
    }
    const label = path.basename(p).replace(/\.ledger\.jsonl$/, "");
    for (const id of openIds(lines)) open.push(multi ? `${id} (${label})` : id);
  }
  if (!open.length) return;
  open.sort();

  const guardPath = path.join(cwd, ".proof", "stop-gate.json");
  const key = open.join(",");
  let guard = { key: null, count: 0 };
  try {
    guard = JSON.parse(fs.readFileSync(guardPath, "utf8"));
  } catch {
    // first time; defaults above are fine
  }
  const count = guard.key === key ? guard.count + 1 : 1;

  if (count > MAX_CONSECUTIVE_BLOCKS) {
    // guard 2: fail open rather than trap the session over the same open
    // set indefinitely. Reset so a genuinely new open set gets its own cap.
    try {
      fs.writeFileSync(guardPath, JSON.stringify({ key: null, count: 0 }));
    } catch {
      /* non-fatal */
    }
    return;
  }

  try {
    fs.mkdirSync(path.dirname(guardPath), { recursive: true });
    fs.writeFileSync(guardPath, JSON.stringify({ key, count }));
  } catch {
    /* non-fatal — worst case the cap doesn't persist across calls */
  }

  console.log(
    JSON.stringify({
      decision: "block",
      reason:
        `${open.length} decision(s) proposed but not yet realized/revised/rejected: ${open.join(", ")}. ` +
        `Log a terminal event for each with /proof:decision-log (or reject with a reason if abandoned) ` +
        `before stopping. If none of these apply to what you're doing right now, say so — this check ` +
        `will stop blocking after ${MAX_CONSECUTIVE_BLOCKS} times regardless.`,
    }),
  );
}

main();
