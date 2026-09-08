#!/usr/bin/env node
/**
 * Stop hook — Phase 3 of .plans/live-decision-capture.md. Blocks stopping
 * while the current ticket has decisions that were proposed but never given a
 * terminal event (realize/revise/reject), and tells the agent which ids are
 * still open. This is what makes deviation capture reliable: the agent
 * reconciles against a known list instead of free-associating about what
 * was worth logging.
 *
 * Scoped to the feature branch. The scope (generator/scope.js) resolves the
 * branch's ticket and its scratch paths, so this reconciles the initiative
 * actually in flight — the one ledger for the branch you're on — and nothing
 * else. It is inert on a trunk branch or a detached HEAD (resolveScope null):
 * stopping on main is never blocked over some other branch's open decisions.
 *
 * Two guards, both load-bearing:
 *
 * 1. Inert with no ledger for this scope. If the branch's ledger doesn't exist
 *    yet, exit 0 — every repo/branch that hasn't opted into capture is
 *    unaffected. The ledger's existence is the opt-in (generator/scope.js's
 *    resolveActiveScope uses the same signal), so a branch nobody armed is never
 *    blocked; a branch that opted in but has only a header has no open decisions
 *    and still returns cleanly.
 *
 * 2. A self-built re-entrancy cap. Whether this Claude Code install provides a
 *    documented "stop_hook_active"-style field to detect a hook re-triggering
 *    itself was NOT confirmed in this session. Rather than trust an unconfirmed
 *    field, this hook counts its own consecutive blocks for the *same* open-id
 *    set in a small scoped state file and gives up (exits 0, fails open) after
 *    MAX_CONSECUTIVE_BLOCKS. An agent that is never going to resolve the open
 *    decisions this session must always have a way to actually stop.
 *
 * Blocks via `decision: "block"` + `reason` — documented for Stop hooks by
 * this install's own settings schema.
 */
const fs = require("fs");
const path = require("path");
const { readLines, events } = require("../generator/ledger-cli");
const { ledgerPath } = require("../generator/ledger-paths");
const { resolveScope, stopGatePath } = require("../generator/scope");

const MAX_CONSECUTIVE_BLOCKS = 3;
const TERMINAL = ["realize", "revise", "reject"];

function readStdin() {
  return fs.readFileSync(0, "utf8");
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
    // proceed with an empty input rather than bail — the cwd fallback below
    // still lets the scope check run
  }
  const cwd = input.cwd || process.cwd();
  const scope = resolveScope(cwd);
  if (!scope) return; // inert on trunk / detached HEAD

  const p = ledgerPath(cwd, scope.ticket);
  if (!fs.existsSync(p)) return; // guard 1: no ledger for this scope yet
  let lines;
  try {
    lines = readLines(p);
  } catch {
    return; // an unreadable ledger is not this hook's problem to fix
  }
  const open = openIds(lines);
  if (!open.length) return;

  const guardPath = stopGatePath(cwd, scope.ticket);
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
