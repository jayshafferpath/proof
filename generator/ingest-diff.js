#!/usr/bin/env node
/**
 * Derives a `diff` field for walkthrough data from a real unified diff plus the
 * existing spine + coverage. The diff view is COMPUTED, never hand-authored, so
 * it cannot desync from the decisions.
 *
 * Usage: node generator/ingest-diff.js <data.json> <raw.diff> [out.json]
 */
const fs = require("fs");

// "42-52" | "42" | "~137" (context, no range) -> [lo, hi] or null
function parseRange(lines) {
  if (!lines || /[~]/.test(lines)) return null;
  const m = String(lines).match(/(\d+)\s*-\s*(\d+)/);
  if (m) return [+m[1], +m[2]];
  const single = String(lines).match(/^(\d+)$/);
  if (single) return [+single[1], +single[1]];
  return null;
}

// file -> [{ decision, lo, hi }] from non-context evidence hunks
function buildAnchors(decisions) {
  const byFile = new Map();
  for (const d of decisions) {
    for (const frag of d.evidence || []) {
      const c = frag.code;
      if (!c || c.context || !c.file) continue;
      const range = parseRange(c.lines);
      if (!range) continue;
      if (!byFile.has(c.file)) byFile.set(c.file, []);
      byFile.get(c.file).push({ decision: d.id, lo: range[0], hi: range[1] });
    }
  }
  return byFile;
}

function fileBucket(coverage, file) {
  if (!coverage) return { bucket: null, byDecisions: [] };
  for (const e of coverage.explained || [])
    if (e.file === file) return { bucket: "explained", byDecisions: e.byDecisions || [] };
  for (const key of ["mechanical", "tests", "unexplained"])
    for (const e of coverage[key] || []) if (e.file === file) return { bucket: key, byDecisions: [] };
  return { bucket: null, byDecisions: [] };
}

// Parse a git unified diff into [{ file, hunks: [{ header, lines }] }].
function parseDiff(raw) {
  const files = [];
  let cur = null;
  let hunk = null;
  let oldLn = 0;
  let newLn = 0;

  for (const line of raw.split("\n")) {
    if (line.startsWith("diff --git")) {
      cur = { file: null, hunks: [] };
      files.push(cur);
      hunk = null;
      continue;
    }
    if (!cur) continue;
    if (line.startsWith("+++ b/")) {
      cur.file = line.slice(6).trim();
      continue;
    }
    if (line.startsWith("+++ ") || line.startsWith("--- ")) continue;
    const hh = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hh) {
      oldLn = +hh[1];
      newLn = +hh[2];
      hunk = { header: line.split("@@")[1] ? `@@${line.split("@@")[1]}@@` : line, lines: [] };
      cur.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;
    const sign = line[0];
    if (sign === "+") {
      hunk.lines.push({ old: null, new: newLn, sign: "+", text: line.slice(1) });
      newLn++;
    } else if (sign === "-") {
      hunk.lines.push({ old: oldLn, new: null, sign: "-", text: line.slice(1) });
      oldLn++;
    } else if (sign === " ") {
      hunk.lines.push({ old: oldLn, new: newLn, sign: " ", text: line.slice(1) });
      oldLn++;
      newLn++;
    }
    // "\ No newline at end of file" and blank trailing lines are ignored
  }
  return files.filter((f) => f.file && f.hunks.length);
}

function attributeLine(anchors, newLineNo) {
  if (newLineNo == null || !anchors) return null;
  for (const a of anchors) if (newLineNo >= a.lo && newLineNo <= a.hi) return a.decision;
  return null;
}

function main() {
  const [dataPath, diffPath, outPath] = process.argv.slice(2);
  if (!dataPath || !diffPath) {
    console.error("usage: node generator/ingest-diff.js <data.json> <raw.diff> [out.json]");
    process.exit(2);
  }
  const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  const raw = fs.readFileSync(diffPath, "utf8");
  const anchorsByFile = buildAnchors(data.decisions || []);
  const parsed = parseDiff(raw);

  let attributed = 0;
  const diff = parsed.map((f) => {
    const { bucket, byDecisions } = fileBucket(data.coverage, f.file);
    const anchors = anchorsByFile.get(f.file) || [];
    const hunks = f.hunks.map((h) => ({
      header: h.header,
      lines: h.lines.map((ln) => {
        const decision = ln.sign === "+" || ln.sign === " " ? attributeLine(anchors, ln.new) : null;
        if (decision) attributed++;
        return { old: ln.old, new: ln.new, sign: ln.sign, text: ln.text, decision };
      }),
    }));
    return { file: f.file, bucket, byDecisions, hunks };
  });

  data.diff = diff;
  const out = outPath || dataPath;
  fs.writeFileSync(out, JSON.stringify(data, null, 2) + "\n");
  const files = diff.length;
  const unmapped = diff.filter((f) => f.bucket == null).map((f) => f.file);
  console.log(`ingested ${files} files · ${attributed} lines attributed to decisions`);
  if (unmapped.length) {
    console.log(`  warn  ${unmapped.length} file(s) not in coverage map:`);
    for (const f of unmapped) console.log(`          ${f}`);
  }
  console.log(`wrote ${out}`);
}

main();
