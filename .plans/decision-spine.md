# Plan: decision-spine data model (supersedes merge-tracks.md)

## Status of the prior plan

`merge-tracks.md` is **superseded**. It evaluated decision-as-spine and rejected it
(its "Correction" section) on the grounds that decision-first "splinters p1's single
before/after across four cards," then retreated to *path*-anchored-with-inline-decisions.
That path-anchored shape was built in the UI iteration and judged a dead end. We are
taking the fork the old plan abandoned.

## The two calls that fix the shape

1. **One spine, not two co-equal tracks.** The two-track structure (peer `paths[]` +
   `decisions[]` joined by n:m symmetric links, navigated by crossover + breadcrumb) is
   the dead end. It describes each change twice and makes the reader stitch. Collapse to
   a single spine.
2. **The spine is decisions.** The walkthrough *is* the author's judgment calls in
   explaining-order. Behaviour and code become evidence a decision **owns**, not a peer
   array it links to. Rationale: the diff throws away *reasoning*; reasoning is the
   irreplaceable thing (behaviour is partly recoverable from code + tests). This
   contradicts design.md's "behaviour-first is settled" — that line is now wrong and
   gets rewritten.

## The fan-in resolution (why the old objection no longer holds)

The old plan assumed decision-first means *full trace re-rendered per decision*, so p1
appears four times. It doesn't. **Decisions partition the behaviour; they don't
duplicate it.** Each decision owns only the fragment it is responsible for:

- `d1` (skip, don't throw) owns the **before/after divergence** — the fix. The `:279`
  guard, the `throws → poison-loop` before-trace, the `skip → return` after-trace.
- `d2` (guard at the shared layer) owns a **scope claim**, not p1's trace: "the check
  lives in `OrderSubscription`, which every adapter funnels through → one choke point
  covers created/updated/cancelled/fulfilled/refunded." Its evidence is the call-site,
  not a re-run of the divergence.
- `d4` (observable skip) owns the **log+metric fragment** inside the skip helper.
- `d5` (leave the switch) owns a **non-change**: before-only evidence, no after.

**Validator rule that keeps this honest:** if two decisions can only be evidenced by the
same code hunk with the same highlighted lines, they are one decision, not two —
flag it. This turns "described twice" from an accident into a caught error.

## New schema

Top level loses `paths[]` and the shared `code{}` map. One array; each decision carries
its own evidence inline.

```jsonc
{
  "pr": { "number", "title", "repo" },
  "decisions": [
    {
      "id": "d1",
      "title": "short imperative — the choice, not the file",
      "source": "author | infer",
      "chose": "what was done, one sentence",
      "rejected": "the alternative not taken",
      "why": "2–4 sentences: the consequence that makes this the right call",

      // provenance — exactly one block, by source (validated, unchanged semantics)
      "quote": "near-verbatim author text",      "quoteSrc": "origin",     // iff author
      "inferNote": "inferred vs stated",          "inferSrc": "code path",  // iff infer
      "note": "optional caveat, e.g. 'a deliberate non-change'",

      // EVIDENCE the decision OWNS. 0..n fragments. A non-change may own a
      // before-only fragment; a pure scope call may own a single code anchor
      // with no trace.
      "evidence": [
        {
          "kind": "divergence | trace | anchor",
          // divergence: this decision IS the fix — before/after that split
          "before":  [ { "step": "…", "note": "factual, checkable" } ],
          "after":   [ { "step": "…", "note": "factual, checkable", "terminal": true } ],
          "divergeAt": 0,                 // index into after where it splits from before
          "divergeNote": "file.ts:279 — the line responsible",
          // trace: a sequence with no before (kind=new), or single-branch
          "trace":   [ { "step": "…", "note": "…", "terminal": true } ],
          // all kinds: the code that proves this fragment
          "code": { "file", "lines", "hl": [start,end], "context": false,
                    "rows": [ ["47","text",0] ] }
        }
      ]
    }
  ]
}
```

Key differences from today:
- **No `paths[]`.** Behaviour lives inside the decision that causes it.
- **No shared `code{}` map, no `ev` string ids.** Code is embedded in the evidence
  fragment. Kills the whole "does this id resolve" class of bug — there's nothing to
  resolve.
- **No `decisions:[ids]` on hops, no `paths:[ids]` on decisions, no symmetric-link
  check.** The link is containment. There is no crossover to keep bidirectional.
- **Hop notes are factual-only.** Reasoning is the decision's `why`, shown once, above.
  (Same honesty fix the old plan wanted — now structural: reasoning can't leak into a
  trace because the trace is *inside* the reasoning.)
- **Coverage becomes expressible.** A decision may own zero behavioural evidence (a pure
  scope/framing call) and say so, instead of being forced into a fake trace.

## Regression coverage — where did `unchanged` go?

Today p3 (recognized category, `regression:true`) is a path. With no `paths[]`, an
UNCHANGED regression story attaches to the decision it protects (d6, "null is
recognized") as a `trace` evidence fragment tagged `regression: true`. If no decision
owns it, it doesn't belong in a *decision* walkthrough — surface it in the change-shape
summary instead (see open question).

## Settled

1. **Change-shape summary — dropped.** No overview strip, no top-level `shape[]`. The
   walkthrough is purely the ordered decisions; the reader gets the shape by reading them
   in explaining-order (the framing decision comes first and sets the frame). This is the
   simplest model and keeps the single-spine promise honest — no second array of any
   kind. Accepted cost: no 3-line "what is this PR" for a skim; the framing decision must
   carry that weight instead.
2. **Ordering — explaining-order** (framing → mechanism → edge/error posture), as the
   prompt already specifies.
3. **`kind` lives on evidence, not the decision.** A decision may own a mix (rare but
   real: a mechanism decision with both a divergence and a defensive non-change). Evidence
   `kind` ∈ `divergence | trace | anchor`; `regression: true` is a flag on a `trace`.

## Files this touches (data-model iteration only — no UI yet)

- `prototype/data/sample-fix.json` — rewrite in the new shape. This is the artifact we
  iterate on. d1 divergence, d2 anchor-only scope claim, d4 helper fragment, d5
  before-only non-change, d6 regression trace.
- `validate.js` — drop symmetric-link + ev-resolution + reachability checks; add the
  duplicate-evidence check (two decisions, same hunk+hl ⇒ error) and embedded-code shape
  checks. Keep author⇒quote, infer⇒note, divergeAt-range.
- `docs/generation-prompt.md` — rewrite: emit decisions with owned evidence; "partition,
  don't duplicate"; the duplicate-evidence rule as a generation instruction.
- `index.html` — **out of scope for this iteration.** Data model first; render later.

## Verification

`node validate.js prototype/data/sample-fix.json` → `valid`, with the new checks
exercised (temporarily duplicate an evidence hunk, confirm it errors).
