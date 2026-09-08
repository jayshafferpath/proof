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
const path = require("path");

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

module.exports = { slug, ledgerDir, ledgerPath };
