#!/usr/bin/env node
/**
 * PostToolUse hook (matcher "Edit|Write") — Phase 3 of
 * .plans/live-decision-capture.md. Reads the real hook JSON Claude Code
 * pipes to stdin and appends one observation: file, the line range actually
 * touched, current git HEAD, and a best-effort enclosing symbol.
 *
 * The stdin field names here (tool_name, tool_input.file_path/old_string/
 * new_string/content, tool_response.structuredPatch) were confirmed by
 * triggering real Edit and Write calls against a diagnostic logging hook in
 * this repo and reading back the actual payload — not assumed from
 * documentation, which turned out to disagree with itself on other hooks.
 *
 * Always exits 0. An edit to a file outside any git repo, or any failure
 * reading/parsing, is silently skipped — this hook must never be the reason
 * a tool call looks like it failed.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { appendObservation, enclosingSymbol } = require("../generator/observe");

function readStdin() {
  return fs.readFileSync(0, "utf8");
}

function gitHead(dir) {
  return execFileSync("git", ["-C", dir, "rev-parse", "--short", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

// structuredPatch (from tool_response) is a list of hunks with newStart/
// newLines already computed by the edit itself — exactly the range that
// changed, no diffing of our own required.
function rangeFromPatch(patch) {
  if (!Array.isArray(patch) || !patch.length) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const h of patch) {
    lo = Math.min(lo, h.newStart);
    hi = Math.max(hi, h.newStart + Math.max(h.newLines, 1) - 1);
  }
  return [lo, hi];
}

function main() {
  let input;
  try {
    input = JSON.parse(readStdin());
  } catch {
    return; // not valid JSON — nothing safe to do
  }
  const { tool_name: toolName, tool_input: toolInput, tool_response: toolResponse } = input;
  if (!["Edit", "Write"].includes(toolName) || !toolInput || !toolInput.file_path) return;

  const file = toolInput.file_path;
  let range = rangeFromPatch(toolResponse && toolResponse.structuredPatch);
  if (!range) {
    // A Write that created a new file has no patch — the "range" is the
    // whole file. A Write that overwrote an existing file with an identical
    // structuredPatch shape falls back the same way.
    const content = toolInput.content;
    if (typeof content !== "string") return;
    const lineCount = content.split("\n").length;
    range = [1, Math.max(lineCount, 1)];
  }

  let commit;
  try {
    commit = gitHead(path.dirname(file));
  } catch {
    return; // not inside a git repo — nothing to anchor to
  }

  let symbol = null;
  try {
    const content = fs.readFileSync(file, "utf8");
    symbol = enclosingSymbol(content, range[0]);
  } catch {
    // file unreadable (e.g. deleted right after the edit) — observation is
    // still worth recording without a symbol hint
  }

  try {
    // Use the payload's own cwd, not this hook process's — see
    // hooks/record-approval.js for why process.cwd() isn't trusted here.
    const cwd = input.cwd || process.cwd();
    appendObservation(path.join(cwd, ".proof", "observations.jsonl"), {
      file,
      lines: `${range[0]}-${range[1]}`,
      commit,
      symbol,
    });
  } catch {
    // never let a logging failure surface as a tool-call problem
  }
}

main();
