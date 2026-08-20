# Plan: build-time decision ledger (capture, don't reconstruct)

## The thesis

`design.md` says *"Reasoning cannot be recovered, so that is where the effort goes"* — and
builds the whole tool around recovering it anyway, post-hoc, from `title + body + commits +
diff` in one model pass. That reconstruction is the only nondeterministic step and the only
place provenance can be wrong.

But the reasoning is **not** lost. It is produced, first-hand, while `ticket-work` builds the
change — and then discarded into Jira-comment prose and plan files. Capture it at the moment
of the decision and proof stops reconstructing: it **projects** a ledger the agents already
know down to the walkthrough spine. Determinism, provenance honesty, and exact
evidence-attribution all fall out together, because you are logging facts as they happen, not
re-deriving them probabilistically on every render.

This is additive. PRs built outside the instrumented flow (external contributors, hand-built
branches) have no ledger and fall back to today's reconstruction. The `source` field says
which path produced each decision.

## A decision has a lifecycle, and ticket-work walks it

The flat `decisions[]` spine is a snapshot. The real object is a decision moving through the
lifecycle, and each `ticket-work` phase owns one transition:

| Phase (step) | First-hand knowledge | Emits |
|---|---|---|
| plan — `plan-ticket`/`jira-start` (S4.1) | intended approach, alternatives weighed, the AC it satisfies | `propose` |
| approval (S4.2) | a human said yes to the plan | `confirm` (provenance upgrade) |
| execute — `plan-execute` (S4.3) | the exact lines that implement each item; **deviations from plan** | `realize` + anchors |
| review — `pr-review`/`pr-execute-plan` (S4.6–8) | issue found → fix → the reasoning delta | `revise` |
| copilot — `pr-watch` (S4.9) | external-review-driven change | `revise` (through-review) |

The two highest-value events are the ones a diff can *never* show: **`realize` deviations**
("planned X, did Y because Z") and **`revise`** (reasoning reached through review). Today both
evaporate.

> **The canonical structure now lives in `docs/ledger-schema.md`.** This section keeps the
> rationale; the field-by-field contract, invariants, and provenance derivation are there and
> are the source of truth if the two ever disagree.

## Structure: event-sourced, append-only

One JSON object per line, appended — never rewritten — as work progresses.

```jsonc
// .proof/ledger.jsonl  (append-only, committed to the branch)
{
  "event":  "propose | confirm | realize | revise | reject | close",
  "id":     "d3",                 // stable decision id, minted at propose
  "ticket": "PROJ-123",
  "phase":  "plan | execute | review | copilot",
  "seq":    7,                    // monotonic per ticket — ordering without wall-clocks
  "by":     "agent | human",      // human on confirm / red-line
  "commit": "9f88b24",            // HEAD when written — the anchor pin

  // decision content — set on propose, patched by later events
  "title":  "Guard the flag before claiming the slot",
  "chose":  "…", "rejected": "…", "why": "…",
  "ac":     ["AC-2"],             // Jira AC / EARS requirement this satisfies

  // evidence — captured first-hand, so anchors are EXACT, not line-matched after the fact
  "anchors": [
    { "file": "src/order.ts", "lines": "276-281", "sha": "9f88b24",
      "fingerprint": "sha256:…",           // survives rebase; reconcile to HEAD at render
      "role": "divergence", "divergeAt": "279" }
  ],
  "tests":  [ { "file": "src/order.test.ts", "name": "skips on missing flag" } ],

  // revise/reject carry the delta and why it changed
  "supersedes": "d3@seq4",
  "reason":     "narrowed after review — the union-widening broke narrowing"
}
```

Why event-sourced, not one evolving document:
- **Parallel agents.** Queue mode runs tickets concurrently; append-only has no write race.
- **Resumable.** The idempotent-checklist ethos is already event-shaped — events are immutable
  facts, re-runs append, nothing is clobbered.
- **Accretion is the point.** A decision's history (proposed → deviated → revised) is the rich
  part. A mutated document throws away exactly what we're trying to keep.

proof's stage 2 becomes a **reducer**: fold events by `id` → current decision state → project
to the existing spine schema (`divergence`/`trace`/`anchor` derive from `anchors[].role`; drop
`reject`ed; provenance tier derived, see below). No invention, minimal variance.

## Provenance gets richer than author/infer

Today's binary exists only because a reconstructor can't tell stated from guessed. First-hand
capture gives a real ladder, **derived from `event`+`by`, never authored**:

- `first-hand` — an `agent` `propose`/`realize` event. The agent that made the change recorded
  why, when. Stronger than `infer`.
- `through-review` — a `revise` event from the review/copilot phase. This is the
  "address review: narrow the payload" reasoning `generation-prompt.md` explicitly prizes and
  currently only hopes to mine from commit bodies.
- `author-confirmed` — a `human` `confirm` event, or a human red-line of the ledger. The plan
  approval (S4.2) already produces this signal; we're just recording it.
- `reconstructed` — fallback tier for the no-ledger path (today's model output).

Two verify tiers sit on top: `machine-verified` (an `agent` `verify` — anchors resolve, quotes
are verbatim, referenced tests exist) and `author-verified` (a `human` `verify` — a person
confirmed the *realized* code matches the reasoning). `verify` is distinct from `confirm`:
`confirm` approves the plan *before* execution, `verify` checks the code *after*. Only
`author-verified` clears a walkthrough for trusted publish; everything below is a draft — which
is the design.md human-verifier step, now a first-class event instead of an assumption.

## Anchors must survive rebase

The flow rebases constantly — stacked PRs, cascade-rebase on cleanup. Raw line numbers rot.
So every anchor is pinned to the `commit` it was captured at **plus** a content `fingerprint`,
and `ingest-diff.js` reconciles to final HEAD at render (it already attributes lines to
decisions; here it maps captured anchors forward instead of matching blind). An anchor whose
fingerprint no longer resolves in the final diff is **flagged for re-verification**, not
silently trusted — reusing the `validate.js` machinery.

## Forks — decided

1. **Transport → committed `.proof/ledger.jsonl` in the branch.** CI reads it from the checkout
   for free; versioned with the code; survives rebase as content. Consequence proof must honour:
   exclude its own ledger file from the coverage map so it doesn't try to explain itself.
2. **Schema scope → superset.** Capture plan-intent, deviations, `reject`s, AC + test links;
   proof projects down. The ledger is worth more than proof alone — it powers `fix-drift`,
   `pr-description`, and requirement→code→test audit.
3. **Who writes events → one shared emitter skill (`/decision-log <event> …`)** the existing
   lifecycle steps call, so the event schema lives in exactly one place rather than scattered
   across `plan-ticket` / `plan-execute` / `pr-execute-plan`.
4. **`reject` events → kept**, rendered only when they carry a `reason`. An alternative actively
   abandoned mid-build (or declined in review) is unique data a diff can't hold; gating render
   on `reason` keeps noise out.

## Files this touches (data-model iteration first — no capture wiring yet)

- **`.plans/build-time-decision-ledger.md`** — this doc. The thing we iterate on.
- **A sample ledger** — `prototype/data/pr-1227.ledger.jsonl` ✅ *written.* Hand-authored from
  the existing `pr-1227.json` to pin the event schema before any skill emits it. 19 events over
  three phases: 4 `propose` (plan) → 4 `confirm` (human approval) → 5 `realize` + 1 `revise`
  (execute) → 2 `reject` + 2 `verify` + 1 `close` (review). The one `revise` (d3@seq12) is the marquee case —
  a plan-intent (reuse the union) *superseded mid-execute* when tsc broke narrowing, which is
  exactly the reasoning the shipped code comment records and a diff throws away. The two
  `reject`s are the real "deliberately not actioned" observations from this PR's review plan.
- **`docs/ledger-schema.md`** — the event contract, once the sample settles.
- **`proof.sh` / a new `generator/reduce-ledger.js`** — stage 2 branches: ledger present →
  reduce → spine; absent → today's reconstruction.
- **`validate.js`** — add fingerprint-resolves check; ledger↔diff reconciliation.
- **ticket-work skills** — the emitter (fork 3). *Out of scope until the schema settles.*

## Verification target

The sample is the fixture for the reducer. `reduce-ledger.js` (fork 3, not yet built) must fold
`pr-1227.ledger.jsonl` → a `decisions[]`/`coverage` object that matches today's `pr-1227.json`
spine, modulo:
- **d3 gains history.** The current spine shows only the final "separate type" decision; the
  reduced ledger additionally knows it *started* as "reuse the union" and why it changed
  (`supersedes` + `reason`). That surplus is the whole point — render it as the decision's
  provenance, don't discard it to match the old shape.
- **r1/r2 are new.** The two `reject`s have no home in today's spine (they're non-changes the
  diff can't show). They render as `reject` decisions gated on `reason`.
- **provenance flips to first-hand / through-review / author-confirmed**, derived from
  `event`+`by`+`phase` — never the reconstructed `author`/`infer` binary.

So the reducer's test isn't "reproduce `pr-1227.json` byte-for-byte" — it's "reproduce its six
decisions' *content*, then add the history and rejects the reconstruction couldn't see."

### Reducer — built (`generator/reduce-ledger.js`) ✅

Folds the sample → 6 decisions + 2 rejects, 19 events. Verified: d1/d2/d5 `author-confirmed`,
d4 `first-hand`, d6 `machine-verified`, **d3 `machine-verified` with the union-reuse state in
`history`** (the stale-confirm result — human approval voided by the mid-execute revise, only an
agent re-check survived), r1/r2 `through-review`. Provenance is the derived ladder end to end;
no fabricated quotes.

### Tier 1 — retrofit, built and proven on NEV-1539 ✅

The lowest-effort path (reconstruct a ledger from a finished ticket's artifacts, no agent change)
is real: `prototype/data/nev-1539.ledger.jsonl` — 12 `by: retrofit` events → 7 decisions + 2
rejects, provenance capped at `reconstructed`/`through-review` (no first-hand/verified). Added the
`retrofit` actor (schema v1.1) so reconstruction can't launder into first-hand. Concept and worked
example: `docs/retrofit-ledger.md`.

### Three interface gaps the fold surfaced (the real next decisions)

Building the projection proved the schema is sound but exposed exactly where the ledger meets
proof's existing renderer. None block the reducer; all block *rendering* a ledger-derived spine.

1. **Provenance representation — DONE.** proof's spine is `source: "author"|"infer"` + a verbatim
   `quote`; the reduced spine emits `provenance` tiers + a `provenanceTrail` and **no quote**.
   Built as `proof.spine/v2`: `schemas/spine.v2.schema.json`, a v2 branch in `validate.js` (no
   author/quote checks), and a provenance-native Decisions tab in `generate.js` (tier badges,
   `history` disclosure, `reject` cards). NEV-1539 renders at `prototype/pr-NEV-1539.html`. No
   quote was faked. Remaining gaps #2/#3 keep v2 at **draft**.
2. **Step narration.** The ledger captures anchors + `role`, not the `step`/`note` sequences
   proof's `divergence`/`trace` fragments render. Either the emitter records steps too, or they
   are derived at render from the anchored code (design.md's "trace comes free from the code"
   claim, now cashable). Reduced evidence currently has `kind` + `code`, empty steps.
3. **Coverage completeness.** The ledger yields `explained` + referenced `tests` only;
   `mechanical` wiring (deliberately unledgered) and the full test-file set need diff
   reconciliation via `ingest-diff.js`. Reduced coverage: explained 3 / tests 1, vs the
   original's explained 3 / mechanical 10 / tests 6.

## Open

- **Fingerprint scheme.** Exact bytes are too brittle across formatters; a normalized-token
  or symbol-scoped hash is more robust. Needs its own spike.
- **Confidence.** Should an agent self-rate a decision's blast radius / uncertainty, feeding
  `design.md`'s open "Weight" question? Cheap to capture, unproven in render.
- **Cross-repo tickets.** A ticket spanning repos (per `planner`) produces one ledger or one
  per repo? Likely per-repo, keyed by ticket — mirrors the worktree-per-repo layout.
