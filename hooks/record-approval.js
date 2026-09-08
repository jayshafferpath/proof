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
const { execFileSync } = require("child_process");
const { recordHumanAttestation } = require("../generator/ledger-cli");
const { resolveScope, attestPath } = require("../generator/scope");
const { ensureLedgerHeader } = require("../generator/ledger-paths");

function readStdin() {
  return fs.readFileSync(0, "utf8");
}

function gitHead(dir) {
  return execFileSync("git", ["-C", dir, "rev-parse", "--short", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function main() {
  let input;
  try {
    input = JSON.parse(readStdin());
  } catch {
    return;
  }
  if (input.tool_name !== "ExitPlanMode") return;

  // Use the payload's own cwd, not this hook process's — how Claude Code sets a
  // spawned hook's working directory isn't something to rely on. The scope (the
  // feature branch's ticket) is the branch's, not a sticky state.ticket that
  // could be left over from another session; inert on trunk / detached HEAD.
  const cwd = input.cwd || process.cwd();
  const scope = resolveScope(cwd);
  if (!scope) return;

  let commit;
  try {
    commit = gitHead(cwd);
  } catch {
    return; // not inside a git repo
  }

  try {
    ensureLedgerHeader(cwd, scope.ticket);
    recordHumanAttestation(attestPath(cwd, scope.ticket), {
      ticket: scope.ticket,
      kind: "confirm",
      commit,
    });
  } catch {
    // never let a logging failure surface as a tool-call problem
  }
}

main();
