#!/usr/bin/env node
/**
 * Validates decision-spine walkthrough data against the rules in
 * docs/generation-prompt.md.
 * Usage: node validate.js prototype/data/sample-fix.json
 */
const fs = require("fs");
const path = require("path");
const { negotiate } = require("./generator/contract");
const { checkFile } = require("./generator/schema-check");

const file = process.argv[2];
if (!file) {
  console.error("usage: node validate.js <data.json>");
  process.exit(2);
}

const data = JSON.parse(fs.readFileSync(file, "utf8"));

// Contract gate: this validator implements the proof.spine/v1 ruleset. A newer
// or foreign contract is a precondition error (exit 2), not a data-invalid
// result (exit 1). Unversioned input is assumed v1 for back-compat.
let contract;
try {
  contract = negotiate(data.contract, "proof.spine", { defaultMajor: 1 });
} catch (e) {
  console.error(`contract error: ${e.message}`);
  process.exit(2);
}

// Unversioned input is treated as v1; stamp the assumed tag so the structural
// schema (which requires it) passes, and the reader sees what was assumed.
if (contract.assumed) data.contract = "proof.spine/v1";

// v2 (ledger-native) has its own structural schema and a lighter semantic ruleset
// — no author/quote checks (provenance is a derived tier, not a quote). Runs and
// exits here so the v1 path below stays untouched.
if (contract.major === 2) {
  const errs = checkFile(path.join(__dirname, "schemas", "spine.v2.schema.json"), data);
  const ids = new Set((data.decisions || []).map((d) => d.id));
  for (const e of (data.coverage && data.coverage.explained) || []) {
    for (const id of e.byDecisions || []) {
      if (!ids.has(id)) errs.push({ path: `coverage.explained[${e.file}]`, message: `unknown decision "${id}"` });
    }
  }
  // Diff (optional, derived by ingest-diff.js): line attributions must cite real
  // decisions. Files absent from coverage warn (retrofit's unexplained remainder),
  // they don't error.
  const v2warn = [];
  if (Array.isArray(data.diff)) {
    const covFiles = new Map();
    for (const b of ["explained", "tests"])
      for (const e of (data.coverage && data.coverage[b]) || []) covFiles.set(e.file, b);
    for (const f of data.diff) {
      if (!covFiles.has(f.file)) v2warn.push(`diff: ${f.file} not in coverage — unexplained`);
      for (const h of f.hunks || [])
        for (const ln of h.lines || [])
          if (ln.decision && !ids.has(ln.decision))
            errs.push({ path: `diff[${f.file}]:${ln.new}`, message: `cites unknown decision "${ln.decision}"` });
    }
  }
  for (const w of v2warn) console.log(`  warn  ${w}`);
  for (const e of errs) console.log(`  ERROR ${e.path} — ${e.message}`);
  const decs = (data.decisions || []).filter((d) => !d.isReject).length;
  const rej = (data.decisions || []).length - decs;
  const tiers = {};
  for (const d of data.decisions || []) tiers[d.provenance] = (tiers[d.provenance] || 0) + 1;
  console.log(
    `proof.spine/v2 · ${decs} decisions, ${rej} rejects · ` +
      Object.entries(tiers).map(([t, n]) => `${n} ${t}`).join(", "),
  );
  console.log(errs.length ? `\n${errs.length} error(s)` : "\nvalid");
  process.exit(errs.length ? 1 : 0);
}

// Structural gate: the payload must match schemas/spine.v1.schema.json before any
// semantic rule runs. A shape violation is data-invalid (exit 1), reported by
// JSON-pointer path. Semantics that JSON Schema can't express are checked below.
const schemaErrors = checkFile(path.join(__dirname, "schemas", "spine.v1.schema.json"), data);
if (schemaErrors.length) {
  for (const e of schemaErrors) console.log(`  ERROR schema: ${e.path} — ${e.message}`);
  console.log(`\n${schemaErrors.length} schema error(s) — payload does not match proof.spine/v1`);
  process.exit(1);
}

const { decisions = [] } = data;
const decIds = new Set(decisions.map((d) => d.id));
const testFiles = new Set(((data.coverage && data.coverage.tests) || []).map((e) => e.file));
const errors = [];
const warnings = [];
if (contract.assumed) warnings.push(`no contract field — assuming proof.spine/v1`);

const KINDS = ["divergence", "trace", "anchor"];
const steps = (frag, side) => frag[side] || [];

function checkCode(at, code) {
  if (!code) {
    errors.push(`${at}: evidence has no code anchor`);
    return;
  }
  if (!code.file) errors.push(`${at}: code has no file`);
  if (!Array.isArray(code.rows) || code.rows.length === 0) {
    errors.push(`${at}: code has no rows`);
  }
  if (code.hl && code.hl.length) {
    const [a, b] = code.hl;
    if (a == null || b == null || b < a) errors.push(`${at}: bad hl range [${a}, ${b}]`);
  }
}

// A signature identifying the exact hunk+emphasis a fragment rests on. Two
// decisions sharing one is the "these are really one decision" smell.
function evidenceKey(code) {
  if (!code) return null;
  return `${code.file}|${code.lines}|${(code.hl || []).join("-")}`;
}
const evidenceOwners = new Map();
// file -> Set(decision ids) that anchor it via a non-context fragment
const anchoredFiles = new Map();

for (const d of decisions) {
  if (d.source === "author") {
    if (!d.quote) errors.push(`${d.id}: source=author requires a quote`);
    if (!d.quoteSrc) errors.push(`${d.id}: source=author requires quoteSrc`);
  } else if (d.source === "infer") {
    if (!d.inferNote) errors.push(`${d.id}: source=infer requires inferNote`);
    if (!d.inferSrc) errors.push(`${d.id}: source=infer requires inferSrc`);
  } else {
    errors.push(`${d.id}: source must be "author" or "infer"`);
  }
  if (!d.rejected) warnings.push(`${d.id}: no rejected alternative — is this really a decision?`);
  if (!d.why) errors.push(`${d.id}: missing why`);

  const evidence = d.evidence || [];
  if (evidence.length === 0) {
    warnings.push(`${d.id}: owns no evidence — a pure framing/scope call, or unfounded?`);
  }

  for (const [i, frag] of evidence.entries()) {
    const at = `${d.id}.evidence[${i}]`;
    if (!KINDS.includes(frag.kind)) {
      errors.push(`${at}: unknown kind "${frag.kind}"`);
    }
    checkCode(at, frag.code);

    if (frag.kind === "divergence") {
      if (!frag.before || !frag.before.length) errors.push(`${at}: divergence requires a before sequence`);
      if (!frag.after || !frag.after.length) errors.push(`${at}: divergence requires an after sequence`);
      if (frag.divergeAt == null) {
        warnings.push(`${at}: divergence has no divergeAt marker`);
      } else {
        const longest = Math.max(steps(frag, "before").length, steps(frag, "after").length);
        if (frag.divergeAt >= longest) errors.push(`${at}: divergeAt ${frag.divergeAt} out of range`);
      }
      if (!steps(frag, "after").some((s) => s.terminal)) {
        warnings.push(`${at}: after sequence has no terminal step`);
      }
    } else if (frag.kind === "trace") {
      if (!frag.trace || !frag.trace.length) errors.push(`${at}: trace requires a trace sequence`);
      if (!(frag.trace || []).some((s) => s.terminal)) {
        warnings.push(`${at}: trace has no terminal step`);
      }
    } else if (frag.kind === "anchor") {
      if (!frag.claim) errors.push(`${at}: anchor requires a claim`);
    }

    for (const side of ["before", "after", "trace"]) {
      for (const [j, s] of steps(frag, side).entries()) {
        if (!s.step) errors.push(`${at}.${side}[${j}]: missing step text`);
      }
    }

    // Tested-by (optional): a per-scenario test list. Each cited test file must
    // be a real test file in the coverage map — you can't claim a behaviour is
    // verified by a file that isn't a declared test.
    for (const [j, t] of (frag.tests || []).entries()) {
      if (!t.name) errors.push(`${at}.tests[${j}]: missing test name`);
      if (!t.file) {
        errors.push(`${at}.tests[${j}]: missing test file`);
      } else if (data.coverage && !testFiles.has(t.file)) {
        errors.push(`${at}.tests[${j}]: "${t.file}" is not in coverage.tests`);
      }
    }

    // Duplicate-evidence check: two decisions resting on the identical
    // hunk+highlight are one decision, not two. Skip context-only anchors,
    // which legitimately point at shared unchanged code.
    if (!frag.code || frag.code.context) continue;
    if (frag.code.file) {
      if (!anchoredFiles.has(frag.code.file)) anchoredFiles.set(frag.code.file, new Set());
      anchoredFiles.get(frag.code.file).add(d.id);
    }
    const key = evidenceKey(frag.code);
    if (key) {
      if (evidenceOwners.has(key)) {
        errors.push(
          `${at}: same evidence hunk as ${evidenceOwners.get(key)} ` +
            `(${key}) — these are one decision, not two`,
        );
      } else {
        evidenceOwners.set(key, d.id);
      }
    }
  }
}

// Coverage map (optional): a manifest checked against the spine. Absent = today.
const cov = data.coverage;
if (cov) {
  const BUCKETS = ["explained", "mechanical", "tests", "unexplained"];
  const seen = new Map(); // file -> bucket, to enforce one-bucket-per-file
  for (const bucket of BUCKETS) {
    for (const entry of cov[bucket] || []) {
      if (!entry.file) {
        errors.push(`coverage.${bucket}: entry has no file`);
        continue;
      }
      if (seen.has(entry.file)) {
        errors.push(
          `coverage: ${entry.file} is in both ${seen.get(entry.file)} and ${bucket} — one bucket per file`,
        );
      } else {
        seen.set(entry.file, bucket);
      }
    }
  }

  // Reverse honesty: explained[file].byDecisions may only name decisions that anchor it.
  for (const entry of cov.explained || []) {
    const actual = anchoredFiles.get(entry.file);
    if (!actual) {
      errors.push(
        `coverage.explained: ${entry.file} is listed as explained, but no decision anchors it`,
      );
      continue;
    }
    for (const id of entry.byDecisions || []) {
      if (!decIds.has(id)) {
        errors.push(`coverage.explained[${entry.file}]: unknown decision "${id}"`);
      } else if (!actual.has(id)) {
        errors.push(
          `coverage.explained[${entry.file}]: claims ${id}, but ${id} anchors no evidence there`,
        );
      }
    }
  }

  // Forward coverage: every non-context anchored file must be accounted for in explained.
  const explainedFiles = new Set((cov.explained || []).map((e) => e.file));
  for (const [file, ids] of anchoredFiles) {
    if (!explainedFiles.has(file)) {
      errors.push(
        `coverage: ${file} is anchored by ${[...ids].join(", ")} but missing from coverage.explained`,
      );
    }
  }

  for (const entry of cov.unexplained || []) {
    warnings.push(`coverage: ${entry.file} unexplained${entry.why ? ` — ${entry.why}` : ""}`);
  }
}

// Diff (optional): a derived consistency check, not a new invariant. The diff is
// computed by ingest-diff.js from the spine + coverage, so validation just guards
// against a stale/hand-edited diff drifting from them.
const diff = data.diff;
if (diff) {
  const bucketOf = new Map();
  if (cov) {
    for (const b of ["explained", "mechanical", "tests", "unexplained"])
      for (const e of cov[b] || []) bucketOf.set(e.file, b);
  }
  for (const f of diff) {
    if (cov && !bucketOf.has(f.file)) {
      warnings.push(`diff: ${f.file} is not in the coverage map`);
    } else if (cov && f.bucket && f.bucket !== bucketOf.get(f.file)) {
      errors.push(`diff: ${f.file} bucket "${f.bucket}" disagrees with coverage "${bucketOf.get(f.file)}"`);
    }
    for (const h of f.hunks || []) {
      for (const ln of h.lines || []) {
        if (!ln.decision) continue;
        if (!decIds.has(ln.decision)) {
          errors.push(`diff: ${f.file} line ${ln.new} cites unknown decision "${ln.decision}"`);
        } else if (!(anchoredFiles.get(f.file) || new Set()).has(ln.decision)) {
          errors.push(
            `diff: ${f.file} line ${ln.new} attributed to ${ln.decision}, which anchors no evidence in that file`,
          );
        }
      }
    }
  }
}

const authored = decisions.filter((d) => d.source === "author").length;
const fragCount = decisions.reduce((n, d) => n + (d.evidence || []).length, 0);
console.log(
  `${decisions.length} decisions ` +
    `(${authored} author-stated, ${decisions.length - authored} inferred) · ` +
    `${fragCount} evidence fragments`,
);
if (cov) {
  const n = (b) => (cov[b] || []).length;
  console.log(
    `coverage · ${n("explained")} explained, ${n("mechanical")} mechanical, ` +
      `${n("tests")} tests, ${n("unexplained")} unexplained`,
  );
}
if (diff) {
  const lines = diff.reduce(
    (n, f) => n + (f.hunks || []).reduce((m, h) => m + (h.lines || []).filter((l) => l.decision).length, 0),
    0,
  );
  console.log(`diff · ${diff.length} files, ${lines} lines attributed to decisions`);
}
const testedCases = decisions.reduce(
  (n, d) => n + (d.evidence || []).reduce((m, f) => m + (f.tests || []).length, 0),
  0,
);
if (testedCases) {
  const scen = decisions.reduce(
    (n, d) => n + (d.evidence || []).filter((f) => (f.tests || []).length).length,
    0,
  );
  console.log(`tests · ${testedCases} cases across ${scen} behaviour scenarios`);
}
for (const w of warnings) console.log(`  warn  ${w}`);
for (const e of errors) console.log(`  ERROR ${e}`);
console.log(errors.length ? `\n${errors.length} error(s)` : "\nvalid");
process.exit(errors.length ? 1 : 0);
