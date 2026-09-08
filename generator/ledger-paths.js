#!/usr/bin/env node
/**
 * One ledger per initiative/PR, not one per repo. Every writer and hook that
 * needs "the ledger" (or the scratch state next to it) for the ticket
 * currently in play resolves the same path from here, keyed by ticket — so
 * a repo that works multiple tickets over time never folds their decisions
 * into one growing file, and each PR's ledger stays small enough to review
 * and commit alongside that PR's own diff (docs/ledger-schema.md: "committed
 * to the branch" means committed *with that PR*, not accumulated forever).
 */
const fs = require("fs");
const path = require("path");

// The first line of every proof.ledger/v1 file. Lives here (the ledger-path
// authority) rather than in ledger-cli.js so both the deterministic writer and
// the header-only bootstrap below single-source it without a circular import.
const HEADER = { contract: "proof.ledger/v1" };

// Tickets are usually already filesystem-safe ("NEV-4201", or a branch name
// used as a fallback ticket). Sanitize defensively for anything else without
// lowercasing — case is part of a ticket key, and the file should stay
// recognizable to a human browsing .proof/ledgers/.
function slug(ticket) {
  const s = String(ticket || "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "untitled";
}

function ledgerDir(cwd) {
  return path.join(cwd, ".proof", "ledgers");
}

function ledgerPath(cwd, ticket) {
  return path.join(ledgerDir(cwd), `${slug(ticket)}.ledger.jsonl`);
}

// Create the ledger with just its header if it doesn't exist yet. Idempotent —
// a no-op once any event (or the header) is present. Called by the capture
// hooks so a feature branch is never left with observations but no ledger; the
// deterministic writer (ledger-cli.appendEvent) sees the lone header line, reads
// zero events, and appends the first real event without a second header.
function ensureLedgerHeader(cwd, ticket) {
  const p = ledgerPath(cwd, ticket);
  if (fs.existsSync(p)) return p;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(HEADER) + "\n");
  return p;
}

module.exports = { slug, ledgerDir, ledgerPath, HEADER, ensureLedgerHeader };
