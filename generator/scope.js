#!/usr/bin/env node
/**
 * The one place that answers "which branch am I on, and what ticket does its
 * work belong to" — and where that ticket's scratch state lives on disk.
 *
 * A proof scope is a feature branch. The ledger for a branch already nests
 * per-ticket (generator/ledger-paths.js); this module puts the *scratch* state
 * (observations, human attestations, sticky phase, the stop-gate counter) under
 * the same ticket key instead of a single global .proof/ pile. Before this,
 * that scratch lived at .proof/observations.jsonl etc. and was shared across
 * every branch and sticky across sessions — so a later session on `main` wrote
 * observations that anchored to main's HEAD but were attributed, via a stale
 * .proof/state.json, to a branch that wasn't even checked out. Keying scratch
 * off the branch the way the ledger already is closes that: a session's writes
 * can only land under the scope it's actually working in.
 *
 * `resolveScope` returns null on a trunk branch (or a detached HEAD): trunk is
 * not where feature work is captured, and returning null is the single "be
 * inert" signal every hook checks — the guard that keeps capture from firing
 * for edits on main.
 */
const path = require("path");
const { execFileSync } = require("child_process");

// Branches that are never a proof scope: shared history, not one PR's work.
const TRUNK = new Set(["main", "master", "develop", "development", "trunk"]);

// A Jira-style key at the start of the branch name ("NEV-1645-add-x" -> "NEV-1645");
// falls back to the whole branch name for repos that don't name branches that way.
// Single source of truth — decision-log.js and the hooks import this rather than
// each carrying their own copy.
function deriveTicketFromBranch(branch) {
  const m = branch.match(/^[A-Z][A-Z0-9]*-\d+/);
  return m ? m[0] : branch;
}

function currentBranch(cwd) {
  try {
    return execFileSync("git", ["-C", cwd, "branch", "--show-current"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

// The active scope, or null when there's nothing to capture: a trunk branch, or
// no branch at all (detached HEAD, not a git repo). Null is the inert signal.
function resolveScope(cwd) {
  const branch = currentBranch(cwd);
  if (!branch || TRUNK.has(branch)) return null;
  return { branch, ticket: deriveTicketFromBranch(branch) };
}

function scratchDir(cwd, ticket) {
  return path.join(cwd, ".proof", "scratch", ticket);
}

function observationsPath(cwd, ticket) {
  return path.join(scratchDir(cwd, ticket), "observations.jsonl");
}

function attestPath(cwd, ticket) {
  return path.join(scratchDir(cwd, ticket), "human-attest.jsonl");
}

function statePath(cwd, ticket) {
  return path.join(scratchDir(cwd, ticket), "state.json");
}

function stopGatePath(cwd, ticket) {
  return path.join(scratchDir(cwd, ticket), "stop-gate.json");
}

module.exports = {
  TRUNK,
  deriveTicketFromBranch,
  currentBranch,
  resolveScope,
  scratchDir,
  observationsPath,
  attestPath,
  statePath,
  stopGatePath,
};
