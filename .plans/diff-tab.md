# Plan: two-tab shell + diff-based reverse index

## Why this is not the dead end

We killed two co-equal *narrative* tracks. A Diff tab is the **inverse index of the same
spine**, not a second narrative:

- Decisions tab: why → what (decision → the code it shapes). Reading order.
- Diff tab: what → why (changed line → the decision behind it). Lookup order.

Same data, two entry points. The Diff tab is arguably the sharpest demo of the thesis:
"here is the diff you'd normally read blind — now every meaningful line tells you why."

## Architecture

One generator, a tab shell wrapping two panels:

- **Tab 1 — Decisions**: the existing master/detail view (spike-masterdetail), unchanged.
- **Tab 2 — Diff**: a real unified diff, every changed file line-by-line, tinted by
  coverage bucket; clicking an attributed line/hunk reveals the decision behind it.

Both panels are server-rendered; JS toggles which is visible (same static, CSP-safe,
self-contained artifact). Consolidate the spike into the main generator as a `--layout`/tab
build rather than a separate file.

## Data model: a `diff` field, computed not authored

Add a top-level `diff` (optional, like `coverage`). It is **derived** by an ingest tool
from (a) the real `git diff` and (b) the existing spine + coverage — never hand-written, so
it cannot desync from the decisions.

```jsonc
"diff": [
  {
    "file": "packages/marketing/src/subscription/practice-report.default.ts",
    "bucket": "explained",              // from coverage: explained|mechanical|tests|unexplained
    "byDecisions": ["d1","d4","d5","d6"],// file-level, from coverage.explained
    "hunks": [
      {
        "header": "@@ -0,0 +21,10 @@",
        "lines": [
          { "old": null, "new": 21, "sign": "+", "text": "async practiceReportGenerated(msg){", "decision": "d4" },
          { "old": 12,   "new": 12, "sign": " ", "text": "  context line", "decision": null },
          { "old": 13,   "new": null,"sign": "-", "text": "  removed line", "decision": null }
        ]
      }
    ]
  }
]
```

### Attribution rules (in the ingest tool)

- **File bucket**: look the file up in `coverage`. explained → its `byDecisions`;
  mechanical/tests/unexplained → that bucket, no decisions.
- **Line → decision**: for an added/context line at new-line-number N in file F, attribute
  it to decision D iff D has a **non-context** evidence hunk with `file == F` and N within
  `hunk.lines` (parsed "42-52" → [42,52]). Removed (`-`) lines have no new number, so they
  attribute only if their old number falls in range — usually null, honestly.
- A line in an `explained` file that no decision hunk covers stays `decision: null` but the
  file is still tinted explained. Honest: "this file is explained; this particular line
  wasn't individually anchored." No fake precision.
- Overlap is impossible by construction: decisions in one file own disjoint hunks (the
  duplicate-evidence validator guarantees distinct hunks), so a line maps to at most one D.

## validate.js

`diff` is optional; gated like `coverage`. When present, check:
- every `diff[].file` appears in the coverage map (same surface).
- every `line.decision` is a real decision id that actually anchors that file (reuse the
  anchoredFiles map already built).
- `bucket` matches the coverage bucket for that file.
No new load-bearing invariant — the diff is derived, so validation is a consistency check.

## Rendering (Diff tab)

- File list, each with a bucket chip (explained ●, mechanical, tested, unexplained).
- Unified hunks: line-number gutters (old/new), +/- tinting (reuse `.cl.add`), and a subtle
  left-accent on runs of lines attributed to a decision.
- Click an attributed line → a reasoning panel (right, or inline drawer) showing that
  decision's title / chose / why / provenance — reusing the decision card chrome.
- Lines with no decision are readable but inert. Mechanical/test files render collapsed by
  default with their coverage `why`/`covers` as the summary — expand to see the diff.

## Ingest tool: `generator/ingest-diff.js`

`node generator/ingest-diff.js <data.json> <raw.diff> [out.json]`
- parse unified diff (git format) → per-file hunks with old/new line tracking
- attribute via the rules above
- write the augmented JSON (adds/replaces `diff`)
PR 1227: use the real diff (already captured). Toy sample: synthesize a small diff whose
hunks match the evidence line ranges.

## Files

- `generator/ingest-diff.js` — new, the derivation tool.
- `generate.js` — add tab shell; fold in the master/detail decisions panel; add diff panel
  renderer + reasoning drawer; export nothing new externally.
- `generator/style.css` — tab chrome + diff-line styles + bucket chips.
- `validate.js` — optional `diff` consistency checks.
- `prototype/data/pr-1227.json` — add computed `diff`.
- `prototype/data/sample-fix.json` — add computed `diff` (synthesized raw).
- `docs/generation-prompt.md` — note `diff` is tool-derived, not authored.

## Verification

- ingest PR 1227 diff → validate → generate; Diff tab shows all files, explained lines
  click through to decisions, mechanical/tests collapsed with coverage summaries.
- Decisions tab unchanged. Tab toggle works. Absent-`diff` data still generates (Diff tab
  hidden). Light/dark both hold.

## Non-goals

Not side-by-side split diff (unified only). Not word-level intra-line diff. Not editing/
commenting. Not fetching at render time — diff is embedded at ingest.
