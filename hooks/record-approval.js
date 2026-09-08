#!/usr/bin/env node
/**
 * PermissionRequest/PostToolUse hook (matcher "ExitPlanMode") — Phase 3 of
 * .plans/live-decision-capture.md. When a human approves a plan, this
 * records the same attestation Phase 1 already built for a human running
 * `ledger-cli.js human-attest` themselves — the hook just does it
 * automatically instead of requiring the extra manual step.
 *
 * UNVERIFIED IN THIS SESSION: unlike hooks/observe-edit.js, this hook's
 * exact firing behavior was not confirmed against a real ExitPlanMode call
 * — doing that requires an actual plan-mode round trip, which was not
 * forced as part of building this. It is wired defensively (see below) so
 * an unconfirmed field shape fails silently rather than corrupting state or
 * blocking anything. Confirm this empirically before relying on it.
 *
 * Always exits 0.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { recordHumanAttestation } = require("../generator/ledger-cli");

function readStdin() {
  return fs.readFileSync(0, "utf8");
}

function gitHead(dir) {
  return execFileSync("git", ["-C", dir, "rev-parse", "--short", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function currentBranch(dir) {
  return execFileSync("git", ["-C", dir, "branch", "--show-current"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

// Same rule as generator/decision-log.js's resolveTicket: a Jira-style key
// at the start of the branch name, else the whole branch name.
function deriveTicketFromBranch(branch) {
  const m = branch.match(/^[A-Z][A-Z0-9]*-\d+/);
  return m ? m[0] : branch;
}

function main() {
  let input;
  try {
    input = JSON.parse(readStdin());
  } catch {
    return;
  }
  if (input.tool_name !== "ExitPlanMode") return;

  const cwd = input.cwd || process.cwd();
  let ticket;
  let commit;
  try {
    const state = JSON.parse(fs.readFileSync(path.join(cwd, ".proof", "state.json"), "utf8"));
    ticket = state.ticket;
  } catch {
    // no sticky state yet — fall back to deriving from the branch, same as
    // decision-log.js does on an agent's first call for a ticket
  }
  try {
    commit = gitHead(cwd);
    if (!ticket) ticket = deriveTicketFromBranch(currentBranch(cwd));
  } catch {
    return; // not inside a git repo
  }
  if (!ticket) return;

  try {
    // Use the payload's own cwd, not this hook process's — how Claude Code
    // sets the working directory for a spawned hook command isn't confirmed,
    // so don't rely on defaultAttestPath()'s process.cwd() to match the
    // session's .proof/ directory.
    recordHumanAttestation(path.join(cwd, ".proof", "human-attest.jsonl"), {
      ticket,
      kind: "confirm",
      commit,
    });
  } catch {
    // never let a logging failure surface as a tool-call problem
  }
}

main();
