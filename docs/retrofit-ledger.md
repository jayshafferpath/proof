# The retrofit ledger

A **decision ledger** (`proof.ledger/v1`, see `ledger-schema.md`) is the append-only record of
the decisions made while building a change — proposed, realized, revised, rejected, verified —
with the reasoning attached. The point of the project is to *capture* that record so proof does
not have to *reconstruct* reasoning from a diff after the fact.

A **retrofit ledger** is that record built **backwards**: reverse-engineered from a finished
ticket's leftover artifacts — the PR review plan, the commits, the diff — instead of emitted
*forward* by the agent as it worked. It is the Tier-1 path in
`.plans/build-time-decision-ledger.md`.

## What it means

**It is the bootstrap, not the destination.** A retrofit ledger lets us exercise the whole
pipeline — extract → reduce → spine — on real, already-completed tickets *today*, with zero
change to how any ticket-work agent behaves. It turns finished work into fixtures immediately.

**It is honestly second-hand, and the data model enforces that.** Every retrofit event is
written `by: retrofit`, which the provenance ladder caps at `reconstructed` (or `through-review`
when a review artifact attests the event happened). A retrofit event can **never** be labeled
`first-hand` or a verified tier. That cap is the load-bearing rule: reconstruction must not be
able to launder itself into a stronger claim than a live, first-hand emission. A retrofit ledger
therefore announces its own trust level — it is a draft, not an attested record.

**It has a hard ceiling — two things it structurally cannot recover:**

- **Precise evidence.** The diff does not say which hunk implements which decision, so anchors
  stay coarse (file-level, no line pins). Attributing hunks to decisions is exactly the judgment
  the diff discards.
- **In-the-moment reasoning that was never written down** — the "planned X, hit Y, switched to
  Z" deviations. If no artifact recorded it, the retrofit cannot invent it. That deviation
  reasoning is the irreplaceable thing, and it survives only if captured live.

Those two gaps are the entire argument for eventually tapping agents in *live*: they are what a
retrofit can't reach.

## Retrofit vs. live

| | **Retrofit ledger** (Tier 1) | **Live ledger** (Tier 2/3) |
|---|---|---|
| Built | backwards, after the ticket | forward, during the build |
| Source | leftover artifacts | the agent, at decision-time |
| Actor | `by: retrofit` | `by: agent` / `by: human` |
| Provenance ceiling | `through-review` | up to `author-verified` |
| Captures deviations? | only if an artifact noted them | yes, first-hand |
| Agent behavior change | none | one instruction (log the deviation) |

## Worked example — NEV-1539

The first real retrofit, from `attribution-service` PR NEV-1539 (provisioning a Couchdrop shared
link in the batch pipeline). The only surviving artifact was `pr-review-NEV-1539.md` — no plan
file, empty commit bodies — so the ledger was reconstructed from the review plan's Summary,
Notes, and Findings plus the `execute`/`review` commit markers.

`prototype/data/nev-1539.ledger.jsonl` — 12 `by: retrofit` events → **7 decisions + 2 rejects**:

- `D1`, `D4`–`D7` → `reconstructed` (execute-phase decisions inferred from outcome).
- `D3` → `through-review` (the security review verified the fail-closed gate).
- `D2` → `through-review` **with `history: 1`** — realized, then the review's dead-code removal
  folded in as a `revise`, capturing a real mid-review change straight from the artifact.
- `r1`/`r2` → `through-review` — the deferred ordering fix and the won't-fix metric helper, the
  two decisions the review declined to action.

Provenance across the whole ledger is `reconstructed` and `through-review` only — **no
`first-hand`, no verified tier.** That is the cap doing its job on real data.

## How one is made

Two halves:

- **Extraction (interpretive)** — the `/retrofit-ledger` skill (`.claude/skills/retrofit-ledger/`).
  Reads a PR's artifacts (body, commits, and any local `pr-review-*.md`), identifies the
  decisions, and emits `by: retrofit` events through `generator/ledger-cli.js` — the deterministic
  writer that owns `seq`, id minting, `commit`, `supersedes`, and the schema gate. This is model
  judgment, not a fixed parser, because artifact formats vary and the mapping is interpretive.
- **Rendering (deterministic)** — `retrofit.sh <ledger> <pr-number> --repo owner/name`: reduce →
  ingest the PR's own diff (base-pinned via `gh pr diff`, immune to local rebase drift) → enrich
  `pr` with live repo/base/head SHAs → validate (`proof.spine/v2`) → render `prototype/pr-<n>.html`.

So retrofitting any PR is: run `/retrofit-ledger <n>` (produces the ledger) → it calls
`retrofit.sh` (produces the walkthrough).
