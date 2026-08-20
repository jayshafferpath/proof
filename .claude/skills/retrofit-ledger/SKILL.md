---
name: retrofit-ledger
description: Reconstruct a decision-ledger walkthrough from a pull request's artifacts. Use when asked to "retrofit" a PR, build a decision ledger for a PR, or generate a proof walkthrough from an existing/merged PR (not from a live ticket-work run). Reads the PR body, commits, and any local review plan; emits by:retrofit events; renders Decisions + Diff tabs. Takes a PR number (and repo).
---

# Retrofit a decision ledger from a PR

Turn a finished PR into a proof walkthrough by reconstructing its decisions as a
`proof.ledger/v1` ledger, then rendering with `retrofit.sh`. This is the **Tier-1** path
(`docs/retrofit-ledger.md`): reconstruction from artifacts, so every event is `by: retrofit`
and provenance is capped at `through-review` — it can never claim `first-hand`. Do not
fabricate reasoning; assert only what an artifact supports.

The event contract is `docs/ledger-schema.md`. The deterministic back-half (reduce → ingest the
PR diff → validate → render) is `retrofit.sh`; your job is producing the ledger.

**Location.** The commands below invoke this repo's scripts via `${PROOF_HOME:-.}`. When
installed globally (via `install.sh`), set `PROOF_HOME` to the proof checkout; when
running from inside the checkout, it defaults to `.`. Ledgers and renders land under
`$PROOF_HOME/prototype/`.

## Inputs

- `<pr-number>` and `--repo owner/name` (default: current checkout).
- Richest source, if present: the ticket's local review plan
  `~/dev/<TICKET>/.claude/plans/pr-review-<TICKET>.md` — it already names decisions, declined
  findings ("deliberately not actioned"), the security/test verification, and deliberate
  non-changes in its Notes.
- Always available: `gh pr view <n> --repo <repo> --json title,body,commits` and the review
  threads (`--json reviews,comments`).

## Procedure

### 1. Gather

```
gh pr view <n> --repo <repo> --json title,body,commits,headRefName,headRefOid,baseRefName
```
Note the **head SHA** — you will stamp it as each event's `commit`. If a
`pr-review-<TICKET>.md` exists in the ticket worktree, read it; it is the densest source.

### 2. Extract decisions (the judgment)

Identify the **decisions** — points where the author chose one path and a competent engineer
could have chosen another. Prefer choices that change behaviour, safety, or blast radius;
include **deliberate non-changes** and **scoping calls**. Merge one idea spread across files
into a single decision. Aim for 4–8 plus any rejects. For each, map to an event:

| Signal in the artifacts | Event | Phase |
|---|---|---|
| A choice the code realizes (with a rejected alternative + why) | `realize` (carries `title`/`chose`/`rejected`/`why`) | `execute` |
| A choice reached *through review* that changed the code | `revise` (cite the concrete obstacle in `reason`) | `review` |
| A finding the review **declined to action** (deferred / won't-fix) | `reject` (`reason` = why declined) | `review` |
| A review lens that passed (security clean, tests complete) | `verify` (`reason` = what was checked) | `review` |
| Work finished / suites green / AC covered | `close` (`reason` = the summary) | `review` |

Attach `ac` (the AC/requirement ids the change satisfies) where the artifacts state them.

### 3. Emit each event

Every event is written through the CLI, which owns `seq`/id/`supersedes` and schema-gates the
append. Pass the PR **head SHA** as `--commit` (the ledger has no repo/git context of its own):

```
node "${PROOF_HOME:-.}/generator/ledger-cli.js" append \
  --ledger "${PROOF_HOME:-.}/prototype/data/pr-<n>.ledger.jsonl" \
  --commit <PR_HEAD_SHA> \
  --event '{"event":"realize","by":"retrofit","ticket":"<TICKET>","phase":"execute",
            "title":"...","chose":"...","rejected":"...","why":"...","ac":["AC-1"],
            "anchors":[{"file":"path","lines":"~","role":"anchor"}]}'
```

Rules:
- **`by` is always `retrofit`.** Never `agent`/`human` — those are for live capture and would
  falsely claim a stronger tier.
- **Anchors are coarse.** `file` + `role` (`anchor` unless it's a real before/after story). Add
  `lines` only when the artifact cites an exact line (e.g. a review finding `foo.ts:344`); use
  `"~"` otherwise. Set `context: true` for out-of-diff or deliberate-non-change anchors.
- **`realize` may establish a new decision** (it carries a title); `verify` must reference an
  already-emitted decision `id` (the CLI prints each minted id). Attach a `verify` to the
  decision whose evidence the review actually checked.
- **`reject` requires a `reason`** and is its own decision (id `r*`).
- The CLI writes the `{"contract":"proof.ledger/v1"}` header on first append.

### 4. Render

```
"${PROOF_HOME:-.}/retrofit.sh" "${PROOF_HOME:-.}/prototype/data/pr-<n>.ledger.jsonl" <n> --repo <repo>
```

This pulls the PR's own diff (base-pinned — immune to local rebase drift), attributes it,
enriches `pr` with the live repo/base/head SHAs (so code citations link to GitHub), validates
against `proof.spine/v2`, and writes `prototype/pr-<n>.html`.

## Output

Report the rendered path and a one-line summary: N decisions / M rejects, the provenance mix
(all `reconstructed`/`through-review` for a retrofit), and the explained/unexplained file split.
The unexplained files are the honest coverage remainder — do not hide them.
