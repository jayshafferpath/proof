---
name: decision-log
description: Log a decision to the live decision ledger as you make it, during active ticket work — not after the fact. Use at each phase of a real task: propose decisions while planning, realize/revise/reject them while implementing, verify/revise/reject them in review, close when done. Produces a proof.ledger/v1 ledger (.proof/ledgers/<ticket>.ledger.jsonl — one file per initiative/PR) that renders as a proof walkthrough with no reconstruction in it. Do not use this to log decisions from memory after work is finished — that is what /proof:retrofit-ledger is for, and it is honestly capped at a lower provenance tier for exactly that reason.
---

# Log a decision as you make it

This is the live counterpart to `/proof:retrofit-ledger`. Retrofit reconstructs decisions
*after* a PR is finished and is honestly capped at `reconstructed`/`through-review`
(`docs/retrofit-ledger.md`). This skill writes them *as you make them*, which is the only way a
decision can ever earn `first-hand` — and the only way the deviation reasoning a diff can never
show ("planned X, hit Y, switched to Z") survives at all.

The event contract is `docs/ledger-schema.md`. The tool you call is `generator/decision-log.js`,
a thin layer over the deterministic writer (`generator/ledger-cli.js`) that resolves the ticket
and phase for you so a call reads like the judgment it's recording, not bookkeeping.

## The one rule that matters more than the syntax below

**You always write `by: agent`. Never pass `--by human`.** That flag exists so a human can
attest their *own* verify or plan approval, at their own keyboard, as a deliberate action
separate from anything you do — see "Human attestation" in `docs/ledger-schema.md`. Passing it
yourself would be exactly the laundering the provenance ladder exists to prevent: an assertion
dressed up as someone else's evidence. If a human tells you they approved the plan or reviewed
the code, tell them how to record that themselves (below) — do not record it for them.

## Setup — first call on a ticket

Nothing to install. The first call for a ticket must pass `--phase plan` (or whichever phase
you're actually starting in); after that, phase and ticket are sticky in `.proof/state.json` and
every later call reuses them until you pass a new `--phase`. The ticket is derived from the
current git branch name if you don't pass `--ticket` (a leading `PROJECT-123` pattern, or the
whole branch name if there isn't one).

```sh
node generator/decision-log.js propose --title "..." --chose "..." --rejected "..." --why "..." --phase plan
```

## Procedure, by phase

### Plan — `propose`

For each decision you intend (4–8, same bar as the generation prompt: a point where a competent
engineer could have chosen otherwise — prefer ones that change behaviour, safety, or blast
radius; include deliberate non-changes and scoping calls):

```sh
node generator/decision-log.js propose \
  --title "Skip a disabled account instead of throwing" \
  --chose "Return early and log a skip when the account is disabled." \
  --rejected "Keep throwing, which aborted the whole batch on one disabled account." \
  --why "A single disabled account shouldn't take down the batch for every other account in it." \
  --ac AC-2,AC-3
```

Each call mints its own id (`d1`, `d2`, …) and prints the written event, including the id —
note it, you'll need it for `realize`. Making several of these calls in one turn is normal and
honest: planning genuinely produces all of them at once.

If a human approves the plan, tell them to run this themselves — it's what pairs a `confirm`
event to your proposals:

```sh
node generator/ledger-cli.js human-attest --ticket <ticket> --kind confirm
```

### Execute — `realize` / `revise` / `reject`

One terminal event per proposed decision, when you implement it:

```sh
node generator/decision-log.js realize d1 --phase execute \
  --anchor "src/billing/run-batch.ts:10-14:12-13" \
  --test "src/billing/run-batch.test.ts:skips a disabled account"
```

`--anchor` is `file:lines[:hlLo-hlHi][:context]` — repeat the flag for more than one file. Use
the range you actually just edited; this tool never asks you to type a line you didn't touch on
purpose. Add `context` when the anchor points at code you didn't change but are relying on
(a defensive check elsewhere, an out-of-diff dependency). `--role divergence` or `--role trace`
sets the evidence kind for every `--anchor` in that call if it isn't a plain anchor (`--role`
default). `--test file:name` attaches a test that exercises the decision; repeat it too.

If you implemented something differently than proposed, that difference **is** the point of this
whole system — log it:

```sh
node generator/decision-log.js revise d1 --reason "tsc broke narrowing on the widened union; switched to a separate type" \
  --title "..." --chose "..." --rejected "..." --why "..." --anchor "..."
```

If you discover a decision mid-execution that was never proposed, `realize` may establish it on
the spot by carrying its own `--title`/`--chose`/`--rejected`/`--why` — allowed, but it should be
rare; a proposal you skipped is worth noticing.

If you decide against something without shipping it, `reject` it — a real non-change a diff
can't show:

```sh
node generator/decision-log.js reject --title "..." --chose "..." --rejected "..." --why "..." --reason "why declined"
```

### Review — `revise` / `reject` / `verify`

Same `revise`/`reject` shapes, `--phase review`, `--reason` citing the actual finding. A review
lens that passed clean is your own `verify`:

```sh
node generator/decision-log.js verify d1 --reason "no PHI in the flag context; fail-closed on an unreachable source"
```

If a human reviewed and verified it, tell them to attest and verify themselves — two separate
actions, on purpose:

```sh
node generator/ledger-cli.js human-attest --ticket <ticket> --kind verify
node generator/decision-log.js verify d1 --reason "..." --by human
```

(That second command is the one place a human, not you, runs `decision-log.js` directly.)

### Close

One `close` when the ticket is done:

```sh
node generator/decision-log.js close --reason "all AC covered by tests on this branch; suite green"
```

## What this cannot do yet, and why that's honest

There is no observation hook yet (`.plans/live-decision-capture.md` Phase 3), so every event you
write reduces to `reconstructed` in the rendered walkthrough — the same tier a retrofit gets,
until `agent verify`/`human confirm`/`human verify` raise a specific decision higher. That is
correct, not a bug: `first-hand` requires positive evidence (`observedAt` matching `commit`,
`docs/ledger-schema.md`) that this tool has no way to manufacture honestly. Do not try to work
around it — a decision that reads `reconstructed` today because the hook doesn't exist yet is
telling the truth; a decision that reads `first-hand` because you found a way to fake the
evidence is not, and that's the one failure mode this whole design exists to prevent.

## Output

After logging, report which decisions you proposed/realized/revised/rejected/verified and their
ids, so anyone reading the transcript can find them in `.proof/ledgers/<ticket>.ledger.jsonl`. If a human needs to
confirm or verify something, say so explicitly and give them the exact command — don't run it
for them.
