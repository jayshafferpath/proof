#!/usr/bin/env node
/**
 * Validates walkthrough data against the rules in docs/generation-prompt.md.
 * Usage: node validate.js prototype/data/sample-fix.json
 */
const fs = require("fs");

const file = process.argv[2];
if (!file) {
  console.error("usage: node validate.js <data.json>");
  process.exit(2);
}

const data = JSON.parse(fs.readFileSync(file, "utf8"));
const { paths = [], decisions = [], code = {} } = data;
const errors = [];
const warnings = [];

const codeIds = new Set(Object.keys(code));
const decIds = new Set(decisions.map((d) => d.id));
const pathIds = new Set(paths.map((p) => p.id));
const SIDES = ["before", "after"];

const hops = (p, side) => p[side] || [];

for (const p of paths) {
  if (!["changed", "new", "unchanged"].includes(p.kind)) {
    errors.push(`${p.id}: unknown kind "${p.kind}"`);
  }
  if (p.kind === "changed" && !p.before) {
    errors.push(`${p.id}: kind=changed requires a before trace`);
  }
  if (p.kind === "changed" && p.divergeAt == null) {
    warnings.push(`${p.id}: changed path has no divergeAt marker`);
  }
  if (p.divergeAt != null) {
    const longest = Math.max(hops(p, "before").length, hops(p, "after").length);
    if (p.divergeAt >= longest) errors.push(`${p.id}: divergeAt ${p.divergeAt} out of range`);
  }
  if (p.beforeProvenance === "author" && !p.beforeSrc) {
    errors.push(`${p.id}: author before-state needs beforeSrc`);
  }
  if (!hops(p, "after").some((h) => h.terminal)) {
    warnings.push(`${p.id}: after trace has no terminal hop`);
  }

  for (const side of SIDES) {
    for (const [i, h] of hops(p, side).entries()) {
      const at = `${p.id}.${side}[${i}]`;
      if (!h.main) errors.push(`${at}: missing main`);
      if (h.ev && !codeIds.has(h.ev)) errors.push(`${at}: unknown code id "${h.ev}"`);
      for (const id of h.decisions || []) {
        if (!decIds.has(id)) errors.push(`${at}: unknown decision "${id}"`);
        else {
          const d = decisions.find((x) => x.id === id);
          if (!(d.paths || []).includes(p.id)) {
            errors.push(`${at}: cites ${id}, but ${id}.paths omits ${p.id} (asymmetric link)`);
          }
        }
      }
    }
  }
}

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
  for (const pid of d.paths || []) {
    if (!pathIds.has(pid)) errors.push(`${d.id}: unknown path "${pid}"`);
  }

  const reachable = paths.some((p) =>
    SIDES.some((s) => hops(p, s).some((h) => (h.decisions || []).includes(d.id))),
  );
  if (!reachable) {
    errors.push(`${d.id}: unreachable from the behaviour track — no hop cites it`);
  }
}

const citedCode = new Set();
for (const p of paths) for (const s of SIDES) for (const h of hops(p, s)) if (h.ev) citedCode.add(h.ev);
for (const id of codeIds) if (!citedCode.has(id)) warnings.push(`code "${id}" is never cited`);

const authored = decisions.filter((d) => d.source === "author").length;
console.log(
  `${paths.length} paths · ${decisions.length} decisions ` +
    `(${authored} author-stated, ${decisions.length - authored} inferred) · ${codeIds.size} code anchors`,
);
for (const w of warnings) console.log(`  warn  ${w}`);
for (const e of errors) console.log(`  ERROR ${e}`);
console.log(errors.length ? `\n${errors.length} error(s)` : "\nvalid");
process.exit(errors.length ? 1 : 0);
