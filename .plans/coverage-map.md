# Plan: coverage map — a manifest checked against the decision spine

## Why

The real-PR stress test (pathccm/marketing#1227) exposed the gap design.md already
flagged: 20 files changed, the decision spine explained ~5, and the other 15 were
**silent**. A reviewer can't tell "deliberately omitted as mechanical" from "the tool
missed it." Silence reads as "safe" when it may mean "unexamined."

## What it is — and what it is NOT

A **coverage map**: a flat manifest of the change's surface, each file tagged by how the
spine accounts for it. It is checked *against* the spine; the spine does not link back
into it. This is deliberately **not** the second co-equal track we deleted — there is no
bidirectional crossover, no navigation from a decision into the map. It's an integrity
manifest, like a test-coverage report sitting beside the code it measures.

## Shape

Top-level `coverage` object, four buckets:

```jsonc
{
  "pr": { ... },
  "decisions": [ ... ],           // the spine — unchanged
  "coverage": {
    "explained":   [ { "file": "…", "byDecisions": ["d1","d4"] } ],
    "mechanical":  [ { "file": "…", "why": "handler registration — wiring" } ],
    "tests":       [ { "file": "…", "covers": "gate/claim/release/flag-off" } ],
    "unexplained": [ { "file": "…", "why": "TODO or honest gap" } ]
  }
}
```

- **explained** — a file a decision's evidence anchors. `byDecisions` lists the decision
  ids that touch it.
- **mechanical** — wiring the author consciously chose not to elevate to a decision
  (barrel exports, DI registration, imports). `why` is one phrase. This is the bucket
  that turns a *silent* omission into a *stated* one.
- **tests** — test files. Split out from `mechanical` because "coverage exists" is
  different signal from "wiring"; a reviewer scans it to see the change is tested.
- **unexplained** — anything the author can't yet justify. Each entry **warns** in
  validation; the goal state is empty. This is the honest escape hatch: you may ship with
  gaps, but you must name them.

## The load-bearing validator rules (manifest ↔ spine integrity)

This is what makes the map honest rather than decorative. `coverage` is **optional** — a
PR without it validates exactly as today (back-compat, and trivial PRs need no map). When
present:

1. **Forward coverage.** Every non-`context` file a decision anchors MUST appear in
   `explained` with that decision's id in `byDecisions`. A decision that anchors a file
   absent from the map is an error — the spine claims behaviour the map doesn't account
   for.
2. **Reverse honesty.** `explained[file].byDecisions` may only list decision ids that
   actually anchor that file. You cannot *claim* a file is explained by dN without dN
   having evidence there. Error.
3. **Context excluded.** Files reached only through `context: true` anchors (base-branch
   code, e.g. the ON CONFLICT SQL in #1227) are NOT part of the PR's surface and must not
   appear in `explained`. They may be mentioned nowhere or noted separately later.
4. **One bucket per file.** A file appears in exactly one of the four buckets. Overlap is
   an error (is it explained or mechanical? decide).
5. **`unexplained` warns per entry.** Not an error — you can ship with a named gap — but
   each one nags until resolved. Silence is not success.

Rules 1–2 are the coverage-report analogue of the deleted symmetric-link check, but
one-directional: the map is derived-and-verified against the spine, never a peer the
spine must stay in sync with by hand.

## Files this touches

- `prototype/data/sample-fix.json` — add a `coverage` block. The toy PR touches ~7 files;
  most map to decisions, `validate.js`-style there's little mechanical. Good minimal case.
- `prototype/data/pr-1227.json` — promote the stress-test data into the repo as the second
  sample, WITH a full coverage map: explained (practice-report.default.ts →
  d1/d4/d5/d6, general-features.ld.ts → d2, hubspot-webhook-client.ts → d3), mechanical
  (consumer.ts, index.ts×2, setup.ts, event-schemas.ts, generated-handler.ts,
  practice-reports/index.ts, general-features.{ts,null}.ts, the two sibling test-mock
  edits), tests (the 4 new/edited .test.ts). unexplained: []. This is the case that
  justifies the whole feature.
- `validate.js` — add the five rules above, all gated behind `if (data.coverage)`.
- `generate.js` + `generator/style.css` — render a coverage panel at the FOOT of the page
  (after the spine): a compact table/legend, explained rows linking to their decision
  anchors by number, mechanical/tests/unexplained as terse grouped lists. Subordinate
  chrome — muted, scannable, not a hero. Omit entirely when `coverage` is absent.
- `docs/generation-prompt.md` — new section: emit a coverage map; every changed file lands
  in exactly one bucket; forward/reverse rules; `unexplained` must be justified.

## Verification

- `node validate.js prototype/data/pr-1227.json` → valid, coverage rules exercised
  (temporarily mis-tag a file's `byDecisions`, confirm reverse-honesty errors; drop an
  anchored file from `explained`, confirm forward-coverage errors).
- Generated page: spine unchanged up top; coverage panel at the foot reads as a manifest,
  not a second walkthrough. Absent-coverage data still generates cleanly.

## Non-goals

Not auto-deriving the map from the diff (the author/generator authors it; validation
checks it — same generate→verify split as the spine). Not linking spine→map navigationally.
Not reintroducing runtime paths.
