#!/usr/bin/env node
/**
 * The observation log: a mechanical record of edits, appended the moment
 * they happen — file, line range, the commit HEAD was at, and a best-effort
 * enclosing symbol. This is the core logic Phase 3 of
 * .plans/live-decision-capture.md calls from a hook; this module has no
 * hook-specific mechanics in it (no stdin parsing, no Claude Code payload
 * shape) so it can be tested and used on its own.
 *
 * An observation is not an anchor and not a claim of anything — it is a
 * plain mechanical fact recorded whether or not any decision ever cites it.
 * /proof:decision-log is meant to read this log to offer the agent real
 * edits to point --anchor at, and to stamp a realize's `observedAt` from the
 * observation nearest its anchor (docs/ledger-schema.md "Provenance") —
 * that wiring is not built yet; this module only produces and reads the log.
 * Never synthesize an observation from memory; if a hook didn't record it,
 * it isn't here to select, and that absence is supposed to show up as
 * `reconstructed` downstream, not be papered over.
 *
 * File: .proof/observations.jsonl, one JSON object per line, append-only,
 * gitignored scratch state — distilled into ledger events, never itself
 * part of proof.ledger/v1.
 */
const fs = require("fs");
const path = require("path");

function defaultObservationsPath() {
  return path.join(process.cwd(), ".proof", "observations.jsonl");
}

function readObservations(p) {
  return fs.existsSync(p)
    ? fs.readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l))
    : [];
}

// Appends one observation and returns its stable 1-based index — the number
// an agent later points `--anchor` at instead of typing a line range itself.
// Indices are assigned by position in an append-only file, so they never
// change once given out.
function appendObservation(p, { file, lines, hl, commit, symbol }) {
  const existing = readObservations(p);
  const obs = { file, lines, commit, ts: new Date().toISOString() };
  if (hl) obs.hl = hl;
  if (symbol) obs.symbol = symbol;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, JSON.stringify(obs) + "\n");
  return { index: existing.length + 1, observation: obs };
}

// Best-effort "what function/class contains this line," scanning upward from
// the target line for the nearest declaration in a small set of common
// shapes across JS/TS/Python. Not a parser: a hint for a human or agent to
// sanity-check a `--anchor`, never precise enough to anchor on by itself,
// and never surfaced as anything stronger than that.
// Excluded from the bare "name(...) {" method-shorthand pattern below, which
// would otherwise happily match "if (x) {" or "for (...) {" as a method
// named "if" or "for" — a control-flow line is never a symbol.
const CONTROL_KEYWORDS =
  "if|for|while|switch|catch|function|return|else|do|try|with|await|yield";

const DECL_PATTERNS = [
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s+(?<name>[A-Za-z_$][\w$]*)/,
  /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(?<name>[A-Za-z_$][\w$]*)/,
  /^\s*(?:export\s+)?(?:const|let|var)\s+(?<name>[A-Za-z_$][\w$]*)\s*[:=][^=].*(?:=>|function)/,
  new RegExp(
    `^\\s*(?:public\\s+|private\\s+|protected\\s+|static\\s+|async\\s+)*` +
      `(?<name>(?!(?:${CONTROL_KEYWORDS})\\b)[A-Za-z_$][\\w$]*)\\s*\\([^)]*\\)\\s*(?::[^{]+)?\\{`,
  ),
  /^\s*def\s+(?<name>[A-Za-z_][\w]*)\s*\(/,
];

function enclosingSymbol(content, lineNumber) {
  const lines = content.split("\n");
  const start = Math.min(Math.max(lineNumber, 1), lines.length) - 1;
  for (let i = start; i >= 0; i--) {
    for (const re of DECL_PATTERNS) {
      const m = lines[i].match(re);
      if (m && m.groups && m.groups.name) return m.groups.name;
    }
  }
  return null;
}

module.exports = { defaultObservationsPath, readObservations, appendObservation, enclosingSymbol };
