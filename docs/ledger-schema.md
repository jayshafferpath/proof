# Decision ledger — contract `proof.ledger/v1` (stable)

The canonical contract for the build-time decision ledger. Design rationale lives in
`.plans/build-time-decision-ledger.md`; versioning policy in `contracts.md`. This file is the
annotated companion to `schemas/ledger.v1.schema.json` — the machine-readable structural
authority, checked per event line by `reduce-ledger.js`. Cross-event invariants (monotonic
`seq`, `revise`→earlier `supersedes`, `verify`→prior `realize`) are enforced in code, not the
schema.

## The one structure

Everything is an **append-only JSONL** line — one event per line, written in `seq` order, never
mutated or deleted. A *decision* is not stored: it is the reduction of the events sharing an
`id`. Events are the source of truth; decisions are a view.

Transport: `.proof/ledger.jsonl`, committed to the branch. proof excludes this file from its own
coverage map.

**Contract header.** The stream opens with a bare header line naming the contract; event lines
follow. A consumer negotiates the major it sees and fails closed on an unsupported one.

```
{"contract":"proof.ledger/v1"}
{"event":"propose","id":"d1", … }
```

A long-lived log may carry a second header line if a later emitter version appends one;
`reduce-ledger.js` reads the contract from the header lines and folds only the `event` lines.

## Event

```
event   : "propose" | "confirm" | "realize" | "revise" | "reject" | "verify" | "close"
```

### Identity & ordering — every event

| field | type | notes |
|---|---|---|
| `event` | enum | above |
| `ticket` | string | Jira key, e.g. `NEV-1645` |
| `seq` | int | monotonic per ticket, gap-free — orders events without wall-clocks; survives resume |
| `phase` | enum | `plan` \| `execute` \| `review` \| `copilot` |
| `by` | enum | `agent` \| `human` \| `retrofit` (reconstructed from artifacts after the fact) |
| `commit` | string | HEAD sha when written — the anchor pin |
| `id` | string | decision id (`d3`, `r1`). Present on every event **except `close`** |

### Content — `propose`, patched by `revise`/`reject`

Omitted on `confirm` / `verify` / `close` (they reference a decision, they don't restate it).

| field | type | notes |
|---|---|---|
| `title` | string | the choice, imperative |
| `chose` | string | what was done |
| `rejected` | string | the alternative not taken |
| `why` | string | the consequence that makes it right |
| `ac` | string[] | Jira AC / EARS requirement ids this satisfies |

### Evidence — `realize` / `revise`; optional on `reject`

| field | type | notes |
|---|---|---|
| `anchors` | Anchor[] | captured first-hand, so exact — not line-matched after the fact |
| `tests` | `{file, name}[]` | tests that exercise this decision |

**Anchor:**

| field | type | notes |
|---|---|---|
| `file` | string | repo-relative path |
| `lines` | string | `"54-70"`, or a non-numeric ref like `"~claim"` |
| `sha` | string | commit the anchor was captured at |
| `fingerprint` | string | content hash — reconciles the anchor to final HEAD after rebase |
| `role` | enum | `divergence` \| `trace` \| `anchor` — becomes proof's evidence `kind` |
| `hl` | `[int,int]`? | optional emphasis range |
| `context` | bool? | true = base-branch code not under review |
| `divergeAt` | string? | only on `role: divergence` |

### Transition-specific

| field | on | notes |
|---|---|---|
| `supersedes` | `revise` (required) | `"d3@seq4"` — the earlier event of the same `id` this replaces |
| `reason` | `revise` / `reject` / `confirm` / `verify` / `close` | why it changed, why declined, or what was checked. **A `reject` renders only if `reason` is present.** |

## Event semantics

| event | by | phase (typical) | id | means |
|---|---|---|---|---|
| `propose` | agent | plan | yes | a decision enters the ledger with its content |
| `confirm` | human | plan | yes | the human approved the **plan** (ClaudePlanApproved) — intent signed off |
| `realize` | agent | execute | yes | the decision was implemented; attaches exact anchors + tests |
| `revise` | agent | execute/review | yes | content changed; `supersedes` the prior state, `reason` says why. Keeps history. |
| `reject` | agent | execute/review | yes (`r*`) | an alternative was actively abandoned; a non-change a diff can't show |
| `verify` | agent \| human | review | yes | the **realized evidence** was checked against the reasoning (not the plan) |
| `close` | agent | review | **no** | ledger-level: work finished, suites/AC summary |

`verify` is deliberately separate from `confirm`. `confirm` says *the plan was approved before
execution*; `verify` says *the code that shipped actually matches the claim*. Only `verify`
closes the gap between stated reasoning and realized code — the gap where a self-reported
rationale can be wrong.

## Reduction — events → decision

Fold by `id`, apply in `seq` order:

- `propose` creates the decision from its content.
- `revise` patches content and **retains the superseded state as history** (via `supersedes`) —
  this trail is the data a diff-based reconstruction cannot produce.
- `realize` attaches anchors + tests; never changes content.
- `confirm` / `verify` attach provenance signals; never change content.
- `reject` yields a standalone non-change decision (its own `r*` id).
- `close` is ledger-level — never folds into a decision.

The reduced decision then projects to proof's **existing** `decisions[]` + `coverage` spine
(`role` → evidence `kind`, anchors → embedded `code`). The renderer and validator keep their
current shape; only the *source* of the spine changes.

## Provenance — derived, never authored

A decision's effective tier is the strongest signal among its events:

| signal present | tier |
|---|---|
| no ledger (reconstruction path) | `reconstructed` |
| `by: retrofit`, non-review phase | `reconstructed` |
| `by: retrofit`, `review`/`copilot` phase | `through-review` |
| `agent` `propose`/`realize`/`revise` | `first-hand` |
| any `agent` event in `review`/`copilot` phase | `through-review` |
| `human` `confirm` | `author-confirmed` |
| `agent` `verify` | `machine-verified` |
| `human` `verify` | `author-verified` |

Strength order (weakest → strongest): `reconstructed` < `first-hand` ≈ `through-review` <
`machine-verified` < `author-confirmed` < `author-verified`. `author-verified` is the tier a
walkthrough should require before it is published as trusted; everything below it is a draft.

`retrofit` is the Tier-1 actor: events reconstructed from ticket-work artifacts (the review
plan, commits, the diff) *after* the work is done. It is capped at `through-review` and can
**never** reach `first-hand` or a verified tier — reconstruction must not launder itself into a
stronger claim than a live emission. Only `agent`/`human` events, written during the build
(Tier 2/3), earn the higher tiers.

## Invariants (enforced by `validate.js`)

1. **Append-only.** No event mutated or deleted; `revise`/`reject` supersede.
2. **`seq` monotonic per ticket, gap-free.**
3. **Every non-`close` event carries an `id`;** `propose` mints it, later events reference it.
4. **`revise` carries `supersedes`** pointing at an earlier `seq` of the same `id`.
5. **A `reject` without `reason` is invalid** (nothing to render, no reason to retain).
6. **`verify` references a decision that has a prior `realize` or `revise`** — you cannot verify
   evidence that was never realized.
7. **Anchors pin `sha` + `fingerprint`;** an anchor that does not resolve at final HEAD is
   flagged for re-verification, not silently trusted.
8. **The ledger file excludes itself** from proof's coverage map.

## Still open (do not treat as frozen)

- **`fingerprint` scheme** — exact bytes are too brittle across formatters; a normalized-token
  or symbol-scoped hash is the likely answer. Needs its own spike. The sample uses placeholders.
- **`confidence`** — an optional agent self-rating of blast radius / uncertainty, feeding
  proof's open "Weight" question. Not in the structure yet.
- **`ac` validation** — free-string ids today; could be checked against the ticket's actual AC.
- **`verify` granularity** — currently per-decision. Whether a single `human` `verify` can
  attest a batch of decisions (a `ids: []` form) is unresolved; per-decision is the safe default.

## Changelog

- **v1.0** — initial contract: seven event kinds (`propose`/`confirm`/`realize`/`revise`/
  `reject`/`verify`/`close`), anchor with `sha`+`fingerprint`, derived provenance ladder, the
  eight invariants above, and the header-line `contract` tag.
- **v1.1** — additive: `by` gains `retrofit` (Tier-1 reconstruction actor), capped at
  `through-review` in the provenance ladder. Older readers that only branch on `agent`/`human`
  ignore it; same major.
