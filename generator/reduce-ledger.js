#!/usr/bin/env node
/**
 * Folds an append-only decision ledger (JSONL) into the walkthrough spine.
 * A decision is not stored — it is the reduction of the events sharing an id.
 * See docs/ledger-schema.md for the event contract.
 *
 * Usage: node generator/reduce-ledger.js <ledger.jsonl> [out.json]
 */
const fs = require("fs");
const path = require("path");
const { negotiate } = require("./contract");
const { check } = require("./schema-check");

const LEDGER_SCHEMA = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "schemas", "ledger.v1.schema.json"), "utf8"),
);

// The reducer reads a proof.ledger/v* log and emits a ledger-native spine.
// That spine's provenance model (tiers + trail + history, no author/infer quote)
// is proof.spine/v2 — proposed in docs/spine-schema.md, not yet validatable by
// validate.js (which speaks v1). Emitting the honest tag keeps that explicit.
const SPINE_CONTRACT = "proof.spine/v2";

const RANK = {
  reconstructed: 0,
  "first-hand": 1,
  "through-review": 1,
  "machine-verified": 2,
  "author-confirmed": 3,
  "author-verified": 4,
};

function parse(file) {
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l, i) => {
      try {
        return JSON.parse(l);
      } catch (e) {
        throw new Error(`ledger line ${i + 1}: ${e.message}`);
      }
    });
}

const inReview = (e) => e.phase === "review" || e.phase === "copilot";

function signalOf(e) {
  // Retrofit events are reconstructed from artifacts after the fact — they can
  // never reach first-hand/verified. A review-phase retrofit finding is capped
  // at through-review (the review artifact attests it happened); anything else
  // is reconstructed. Checked first so a retrofit `verify` can't claim machine-verified.
  if (e.by === "retrofit") return inReview(e) ? "through-review" : "reconstructed";
  if (e.event === "confirm" && e.by === "human") return "author-confirmed";
  if (e.event === "verify") return e.by === "human" ? "author-verified" : "machine-verified";
  return inReview(e) ? "through-review" : "first-hand";
}

// A confirm/verify attests the decision as it stood when written; a later
// content `revise` invalidates that attestation. So walk in seq order and reset
// the tier to its base on every revise, letting only subsequent attestations
// re-raise it. This is what makes "the human approved a plan that then changed"
// read as machine-verified, not author-confirmed.
function provenanceTier(events) {
  let tier = null;
  for (const e of events) {
    // A revise invalidates any prior attestation, so reset the tier to the
    // revise's own base (first-hand, or through-review in a review phase);
    // only attestations that come after it may re-raise.
    if (e.event === "revise") {
      tier = signalOf(e);
      continue;
    }
    const s = signalOf(e);
    if (tier === null || RANK[s] > RANK[tier]) tier = s;
  }
  return tier || "first-hand";
}

function foldDecision(id, events) {
  const isReject = events.some((e) => e.event === "reject");
  const content = {};
  const history = [];
  const anchors = [];
  const tests = [];

  for (const e of events) {
    if (e.event === "revise" && content.title) {
      history.push({ seq: content._seq, chose: content.chose, why: content.why, reason: e.reason });
    }
    if (e.title) {
      Object.assign(content, {
        title: e.title,
        chose: e.chose,
        rejected: e.rejected,
        why: e.why,
        ac: e.ac || content.ac,
        _seq: e.seq,
      });
    }
    for (const a of e.anchors || []) anchors.push(a);
    for (const t of e.tests || []) tests.push(t);
  }

  const evidence = anchors.map((a) => ({
    kind: a.role,
    code: { file: a.file, lines: a.lines, hl: a.hl || [], context: !!a.context },
  }));

  return {
    id,
    title: content.title,
    chose: content.chose,
    rejected: content.rejected,
    why: content.why,
    ac: content.ac || [],
    isReject,
    provenance: provenanceTier(events),
    provenanceTrail: events.map((e) => ({
      seq: e.seq,
      event: e.event,
      by: e.by,
      phase: e.phase,
      ...(e.reason ? { reason: e.reason } : {}),
    })),
    history,
    evidence,
    tests,
  };
}

function buildCoverage(decisions) {
  const explained = new Map();
  const testFiles = new Map();
  for (const d of decisions) {
    for (const ev of d.evidence) {
      if (ev.code.context) continue;
      if (!explained.has(ev.code.file)) explained.set(ev.code.file, new Set());
      explained.get(ev.code.file).add(d.id);
    }
    for (const t of d.tests) {
      if (!testFiles.has(t.file)) testFiles.set(t.file, new Set());
      testFiles.get(t.file).add(t.name);
    }
  }
  return {
    explained: [...explained].map(([file, ids]) => ({ file, byDecisions: [...ids] })),
    tests: [...testFiles].map(([file, names]) => ({ file, covers: [...names].join(" / ") })),
  };
}

function reduce(lines) {
  // Header/metadata lines (a bare {"contract": …}) carry no `event`; fold only
  // the event lines, and derive the ticket from the first line that names one.
  const events = lines.filter((l) => l.event);
  const closeEvt = events.find((e) => e.event === "close");
  const byId = new Map();
  for (const e of events) {
    if (!e.id) continue;
    if (!byId.has(e.id)) byId.set(e.id, []);
    byId.get(e.id).push(e);
  }
  const decisions = [...byId.entries()].map(([id, evs]) => foldDecision(id, evs));
  const ticket = (lines.find((l) => l.ticket) || {}).ticket;
  return {
    contract: SPINE_CONTRACT,
    pr: { number: ticket, ticket },
    decisions,
    coverage: buildCoverage(decisions),
    ledgerMeta: {
      ticket,
      events: events.length,
      closed: closeEvt ? { seq: closeEvt.seq, reason: closeEvt.reason } : null,
    },
  };
}

function main() {
  const src = process.argv[2];
  if (!src) {
    console.error("usage: node generator/reduce-ledger.js <ledger.jsonl> [out.json]");
    process.exit(2);
  }
  const out = process.argv[3] || src.replace(/\.jsonl$/, "") + ".reduced.json";
  const lines = parse(src);
  try {
    negotiate((lines.find((l) => l.contract) || {}).contract, "proof.ledger", { defaultMajor: 1 });
  } catch (e) {
    console.error(`contract error: ${e.message}`);
    process.exit(2);
  }
  // Structural gate on every event line before folding. Header lines (no `event`)
  // are negotiated above, not schema-checked.
  const schemaErrors = lines
    .filter((l) => l.event)
    .flatMap((l) => check(LEDGER_SCHEMA, l).map((e) => `event seq ${l.seq}: ${e.path} — ${e.message}`));
  if (schemaErrors.length) {
    for (const m of schemaErrors) console.error(`  ERROR schema: ${m}`);
    console.error(`\n${schemaErrors.length} schema error(s) — ledger does not match proof.ledger/v1`);
    process.exit(1);
  }
  const spine = reduce(lines);
  fs.writeFileSync(out, JSON.stringify(spine, null, 2));
  const real = spine.decisions.filter((d) => !d.isReject).length;
  const rej = spine.decisions.length - real;
  console.log(`wrote ${out} · ${real} decisions, ${rej} rejects, ${spine.ledgerMeta.events} events folded`);
}

if (require.main === module) main();
module.exports = { reduce, provenanceTier, foldDecision };
