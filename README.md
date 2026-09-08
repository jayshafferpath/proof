# proof

`proof` generates a self-contained HTML walkthrough of a pull request. It records the two
things a unified diff discards: the **decisions** the author made, and the **runtime
behaviour** those decisions produce. Every claim is anchored to a real line and tagged with
its provenance — who said it and how strongly it's backed.

`proof` explains a change so a reviewer can approve it. It does not find defects, score
quality, or suggest improvements. Static analysis already hunts for bugs; nothing here does.

## The idea

A diff is **linear** — file after file. A change is **causal** — "added X because Y, which
forced Z." The diff shows the *outcome* of every judgment call and preserves none of the
reasoning; the reviewer reconstructs it in their head, every PR, every time. Two things they
actually need go missing on merge:

- **Reasoning during development** — "used a separate type instead of widening the union,
  because widening breaks narrowing." The judgment calls, including the *deviations*: planned
  X, hit Y, switched to Z.
- **Behaviour** — what the code does at runtime. You approve behaviour, not structure.

A walkthrough is **one spine**: the author's decisions, ordered the way they'd explain them to
a colleague — framing first, mechanisms next, edge/error posture last. Each decision carries
what was **chosen**, what was **rejected**, and **why it matters**. Deliberate *non-changes*
count, and are often the most valuable thing surfaced, because a diff can't show them. See
[`docs/design.md`](docs/design.md) for the full model.

Provenance is the load-bearing rule. A tool that makes a reviewer confident via reasoning
that's subtly wrong is worse than a raw diff, because the reviewer stops looking. So proof
never blurs *who is making a claim and how strongly it's backed* — and it derives that tier
mechanically from the evidence, never letting a source assert a stronger claim than it earned.
That single rule is what decides which of the three paths below you should use.

## Three ways to build a walkthrough — strongest evidence first

The same renderer, validator, and page come out of all three. They differ only in **where the
decisions come from**, and therefore in how much they can honestly claim. The provenance
ladder (weakest → strongest) is:

```
reconstructed  <  first-hand ≈ through-review  <  machine-verified  <  author-confirmed  <  author-verified
```

| Path | How decisions are sourced | Provenance ceiling | Use when |
|---|---|---|---|
| **Live capture** | agent logs them *as it works* | up to `author-verified` | you're doing the work now (the point of the tool) |
| **Retrofit** | reconstructed from a finished PR's artifacts | `through-review` | the PR is already done |
| **Reconstruct-from-diff** | a model reads the diff cold | `reconstructed` | no ledger, no artifacts, just a diff |

### 1. Live capture — the flagship

The only path that can reach `first-hand` and the verified tiers, and the only one that
captures deviation reasoning at all: "planned X, hit Y, switched to Z" is never written down
anywhere a reconstruction could find it later. Capturing it costs one instruction to an agent
that already knows the answer at the moment it matters.

Driven from inside Claude Code by the **`/proof:decision-log`** skill, which writes an
append-only decision ledger (`proof.ledger/v1`, one file per PR at
`.proof/ledgers/<ticket>.ledger.jsonl`) as the work happens:

- **plan** → `propose` each decision you intend
- **execute** → `realize` / `revise` / `reject` each one as you implement (a `revise` with its
  reason is the deviation a diff can't show)
- **review** → `verify` the lenses that passed, `revise`/`reject` what the review changed
- **close** when done

Three Claude Code **hooks** (registered via [`hooks/hooks.json`](hooks/hooks.json)) turn the
discipline from "remember to log" into something structural. All three are scoped to the feature
branch and inert on a trunk branch (`main`/`master`/`develop`) or a detached HEAD, so enabling
the plugin globally is safe and edits on `main` are never captured as orphans:

- `observe-edit` (`PostToolUse` on `Edit`/`Write`) records which lines changed at which commit,
  so anchors are exact and the liveness claim is checkable — not self-reported. The first edit
  on a branch also bootstraps that ticket's ledger with its header, so a scope is never left with
  observations and no ledger.
- `record-approval` (`PostToolUse` on `ExitPlanMode`) records a human plan approval, which the
  ledger later pairs to a `confirm`.
- `reconcile-stop` (`Stop`) blocks the turn from ending while any proposed decision has no
  terminal event — you can't finish with decisions unaccounted for.

Everything a session writes is scoped under the branch's ticket: the ledger at
`.proof/ledgers/<ticket>.ledger.jsonl` (committed with the PR) and the gitignored scratch state
(observations, human attestations, sticky phase, the stop-gate counter) at
`.proof/scratch/<ticket>/` (`generator/scope.js`). Add `.proof/scratch/` to the target repo's
`.gitignore`; commit `.proof/ledgers/`.

`first-hand` is **earned, not asserted**: `by: agent` alone is not evidence an event was
written at decision-time rather than dumped from memory at the end. It requires the
observation hook's `observedAt` to match the commit the event was written at. A repo with no
hooks produces no such evidence, so its events honestly read `reconstructed` — the same tier a
retrofit gets. See [`skills/decision-log/SKILL.md`](skills/decision-log/SKILL.md) and
[`docs/ledger-schema.md`](docs/ledger-schema.md).

### 2. Retrofit — from a finished PR

Reconstruct the ledger **backwards** from a completed PR's leftover artifacts — the PR body,
commits, and any local review plan — instead of emitting it forward. Every event is written
`by: retrofit`, which the ladder caps at `through-review` and can **never** raise to
`first-hand` or a verified tier: reconstruction must not launder itself into a stronger claim
than a live emission. It's the bootstrap that turns already-finished tickets into fixtures
today, with zero change to how any agent behaves — and it announces its own trust level as a
draft. Its one hard ceiling is exactly what live capture exists to fix: reasoning that was
never written down.

```sh
# From inside Claude Code (interpretive extraction, then deterministic render):
/proof:retrofit-ledger <pr-number>          # → ./proof-out/pr-<n>.html
/proof:retrofit-stack  <any-pr-in-a-stack>  # → one walkthrough for the whole chain

# Or render an already-extracted ledger by hand:
proof-retrofit <ledger.jsonl> <pr-number> --repo owner/name --out ./proof-out
```

See [`docs/retrofit-ledger.md`](docs/retrofit-ledger.md) for the ceiling and a worked example.

### 3. Reconstruct-from-diff — the model pipeline

No ledger and no artifacts, just a diff: `proof.sh` has a model read the change cold and draft
the decisions. This is the weakest source — output is `reconstructed` and should be treated as
a draft until a human corrects it — but it needs nothing but the PR.

```sh
proof <pr-number> [--repo owner/name] --out ./proof-out
```

The pipeline is [detailed below](#the-reconstruct-from-diff-pipeline).

## Get started

### Requirements

- `node` (≥18; no `npm install` — the only dependency, EJS, is vendored at
  `generator/vendor/ejs.js`)
- `gh` authenticated against the target repo — for `proof`, `proof-retrofit`, and the retrofit
  skills
- `jq` — for `proof` and `proof-retrofit`
- For **reconstruct-from-diff only** (not needed for live capture, retrofit, or `--data`), one
  of, auto-detected with `aws` preferred:
  - `aws` CLI with Bedrock access
  - `opencode` CLI, authenticated (`opencode auth login`)

### Install the CLI

```sh
npm install -g /path/to/proof     # from a local checkout
npm install -g <git-url>          # or straight from git
```

This puts three commands on your `PATH`:

| command | wraps | use |
|---|---|---|
| `proof <pr-number>` | `proof.sh` | reconstruct-from-diff: gather → generate → render |
| `proof-retrofit <ledger> <pr> --repo <r> --out <dir>` | `retrofit.sh` | render a ledger + PR diff to HTML |
| `proof-render <data.json> [out.html]` | `generate.js` | render walkthrough JSON to HTML |

Commands resolve their own install location, so vendored EJS, templates, and schemas travel
with them — no `npm install`, no `PROOF_HOME`. Running from another repo, pass `--out
./proof-out`; the default output directory sits inside the install, not your current repo.
Likewise give `proof-render` an explicit `out.html` or it writes next to the input JSON.

### Install the plugin (for the `/proof:*` skills)

Live capture and retrofit run from inside Claude Code. The whole checkout **is** the plugin —
scripts and hooks travel with it:

```sh
/plugin marketplace add /path/to/proof     # inside Claude Code
/plugin install proof@proof

claude --plugin-dir /path/to/proof         # or a one-session dev load, from the shell
```

Skills resolve their scripts via `${CLAUDE_PLUGIN_ROOT}` and write the ledger + HTML to
`./proof-out/` in whatever repo you invoke them from. Installing the plugin also registers the
three live-capture hooks.

## The rendered walkthrough

The page has three tabs, all **derived from the same decision spine** — behaviour and diff are
evidence a decision owns, never authored separately, so they cannot desync from the spine. It
opens on **Diff** when the PR has one (the reviewer's first screen is the real diff, not a
claim to be trusted), falling back to **Behaviour** when there are runtime scenarios but no
diff, then **Decisions**.

- **Diff** — the real unified diff, each line tinted by its coverage bucket. Explained lines
  link to the decision behind them; the diff is computed from the spine, so it can't drift.
- **Behaviour** — each runtime scenario the change touches, classified `CHANGED`, `NEW`, or
  `UNCHANGED`. `CHANGED` scenarios render before/after side by side with a divergence marker
  naming the `file:line` where the two paths split — on a bugfix, that line is the fix.
- **Decisions** — master/detail: what the author chose, rejected, and why, each tagged
  author-stated (with a verbatim quote and source) or AI-inferred (with a note on what's
  reconstructed). A `revise` keeps the superseded state as history — the deviation trail a
  diff-based reconstruction can't produce.

## Provenance and validation

`validate.js` enforces provenance mechanically and exits non-zero on any violation:

- author-stated decisions carry a near-verbatim quote; inferred decisions carry a note
- every evidence anchor resolves to a real code location; `divergeAt` is in range
- no two decisions rest on the same evidence hunk
- when a coverage map is present, every non-context file lands in exactly one bucket
  (explained, mechanical, tests, or unexplained) and diff attribution agrees with the spine

With `--inputs <file>`, author quotes are checked **verbatim** (case/whitespace-insensitive)
against the PR title, body, and commit messages — a quote that doesn't appear in the inputs is
an error, not a missing field. `proof.sh` passes this automatically. Without it, validation
still runs but warns that quotes were unchecked.

For live and retrofit ledgers, provenance is **derived, never authored** — the effective tier
is the strongest signal among a decision's events:

| signal | tier |
|---|---|
| no ledger, or `by: retrofit` outside review | `reconstructed` |
| `by: agent`, `observedAt` present and equal to `commit` | `first-hand` |
| any event in `review`/`copilot` phase (incl. `by: retrofit`) | `through-review` |
| `agent` `verify` | `machine-verified` |
| `human` `confirm` (grounded by attestation) | `author-confirmed` |
| `human` `verify` (grounded by attestation) | `author-verified` |

`author-verified` is the tier a walkthrough should reach before it's published as trusted;
everything below it is a draft. A `by: human` `confirm`/`verify` is rejected at write time
unless a matching human **attestation** already exists — a human runs `ledger-cli.js
human-attest` themselves, so the top of the ladder can't be reached by an agent asserting it.

The intended flow is **generate → author corrects → publish**. The generator drafts; the
author is the first verifier. An inferred decision the author confirms becomes author-stated.

## CI

[`.github/workflows/proof.yml`](.github/workflows/proof.yml) runs the reconstruct-from-diff
pipeline on `pull_request`, authenticating to Bedrock via OIDC (no API-key secret), and
branches on the exit code:

- **0** — uploads the rendered HTML as a build artifact and posts a PR comment linking it.
- **1** — posts the validation errors as a PR comment so the author can fix the data.

Both comments upsert by a hidden marker ([`.github/upsert-comment.sh`](.github/upsert-comment.sh)),
so re-running on a push updates one comment rather than accumulating. A failed run never blocks
the PR (`continue-on-error`). The assumed IAM role must permit `bedrock:InvokeModel` on the
chosen model.

## Reference

### The reconstruct-from-diff pipeline

`proof.sh` runs five stages; only stage 2 calls a model.

```
1. gather    gh pr view / gh pr diff              → title, body, diff, commit SHAs
2. generate  prompt + inputs → bedrock | opencode → walkthrough JSON
3. ingest    node generator/ingest-diff.js        → attribute each diff line to a decision
4. validate  node validate.js                     → provenance, evidence, coverage checks
5. render    node generate.js                      → self-contained pr-<n>.html
```

The `pr` object (number, title, repo, headSha, baseSha) is overwritten from resolved `gh`
facts after generation rather than trusted from the model — code citations pin to the SHAs, so
a wrong SHA links to the wrong code. Author-controlled text (title, body, diff) is fenced with
dynamic backtick runs so a crafted description can't pose as prompt structure.

Stages can be run individually:

```sh
node generator/ingest-diff.js <data.json> <raw.diff> [out.json]
node validate.js <data.json> [--inputs <pr-title-body-commits.txt>]
node generate.js <data.json> [out.html]
```

### `proof` flags

| Flag | Default | Description |
|---|---|---|
| `--repo owner/name` | current checkout | Target repository. |
| `--data file.json` | — | Inject pre-generated JSON and skip the model call. For prompt tuning and running the mechanical pipeline without model credentials. |
| `--backend bedrock\|opencode` | auto-detected | `aws` on PATH → bedrock, else `opencode`. `bedrock` calls `aws bedrock-runtime invoke-model`; `opencode` shells out to the CLI. Only needed to override detection. |
| `--model id` | `us.anthropic.claude-sonnet-4-6[1m]` (bedrock) / opencode default | Bedrock: an inference profile the IAM role permits. Opencode: a `provider/model` id. |
| `--prompt file` | `docs/generation-prompt.md` | Generation prompt. |
| `--out dir` | `prototype` | Output directory. |
| `--keep-tmp` | off | Retain the temp working directory. |

### `proof` exit codes

| Code | Meaning |
|---|---|
| `0` | Valid walkthrough rendered to `<out>/pr-<n>.html`. |
| `1` | Validation failed; errors printed to stdout, nothing rendered. |
| `2` | Usage or precondition error. |
| `3` | Generation produced no usable JSON (auth, backstop timeout, or parse failure). |

### Stacks — one walkthrough for a chain of PRs

Work often ships as a **stack**: a chain where each PR's head branch is the next one's base,
promoted to `main` bottom-up. `proof.sh stack` folds a stack into one walkthrough
(`proof.stack/v1`) showing layer ownership, the **seams** where more than one layer touches a
file, and the **builds-on edges** where a later layer's decision rests on a file a lower layer
introduced. It also embeds a **Stack** tab into each layer's own `pr-<n>.html`.

```sh
./proof.sh stack <manifest.json> [--repo owner/name] [--out dir]
```

The manifest names the layers bottom→top, each pointing at a `ledger` or a pre-reduced
`spine`. To go from a single PR number to the whole rendered stack, use `/proof:retrofit-stack`
(it walks the open-PR ref topology, retrofits a ledger per layer, fills the manifest, and
renders). The resolver alone is mechanical:

```sh
gh pr list --repo owner/name --state open --limit 200 \
  --json number,title,baseRefName,headRefName > prs.json
node generator/resolve-stack.js <any-pr-in-the-stack> owner/name prs.json > stack.manifest.json
```

### Layout

```
proof.sh                       reconstruct-from-diff pipeline (gather → generate → ingest → validate → render)
retrofit.sh                    ledger pipeline (reduce → ingest gh pr diff → validate → render)
build.sh                       regenerate the sample walkthroughs from prototype/data
generate.js                    loads templates + assets, renders data → self-contained HTML (spine v1 + v2)
validate.js                    enforces provenance, evidence, coverage; contract-versioned
.claude-plugin/
  plugin.json                  plugin manifest — makes this repo installable as the `proof` plugin
  marketplace.json             single-plugin marketplace catalog (points at ./)
hooks/
  hooks.json                   registers the three live-capture hooks via ${CLAUDE_PLUGIN_ROOT}
  observe-edit.js              PostToolUse Edit|Write → records touched lines + commit (anchors, liveness)
  record-approval.js           PostToolUse ExitPlanMode → records a human plan approval
  reconcile-stop.js            Stop → blocks the turn while a proposed decision has no terminal event
skills/
  decision-log/                /proof:decision-log — live emitter, writes by:agent events as work happens
  retrofit-ledger/             /proof:retrofit-ledger — PR artifacts → by:retrofit ledger
  retrofit-stack/              /proof:retrofit-stack — any PR → resolve chain → per-layer ledgers → stack
generator/
  templates/*.ejs              page shell + card/coverage/behaviour/diff markup
  client.js                    client-side behaviour (tabs, drawer, sort), inlined
  style.css                    stylesheet, inlined at generate time
  ingest-diff.js               attributes each diff line to a decision
  decision-log.js              live-capture emitter front-end over ledger-cli.js
  ledger-cli.js                deterministic ledger writer (seq/id/commit/schema gate, attestation check)
  ledger-paths.js              one ledger file per initiative/PR
  reduce-ledger.js             folds a decision ledger into a walkthrough spine + derives provenance
  compose-stack.js             folds per-layer spines into proof.stack/v1 (seams + builds-on edges)
  resolve-stack.js             walks the PR ref graph → ordered stack + manifest skeleton
  contract.js                  wire-contract negotiation (proof.ledger, proof.spine)
  schema-check.js              zero-dep JSON Schema checker
  vendor/ejs.js                vendored EJS engine (committed; no npm install)
schemas/
  ledger.v1 / spine.v1 / spine.v2   machine-readable structural contracts
prototype/
  *.html                       generated walkthroughs — gitignored, run ./build.sh
  data/*.json  data/*.ledger.jsonl   walkthrough data + ledgers (source of truth)
.github/
  workflows/proof.yml          CI job
  upsert-comment.sh            marker-based PR comment upsert
docs/
  design.md                    the model; settled vs. open questions
  generation-prompt.md         the prompt that produces walkthrough data
  ledger-schema.md             proof.ledger/v1 contract + the provenance ladder
  spine-schema.md              proof.spine contract
  contracts.md                 versioned wire contracts + policy
  retrofit-ledger.md           what a retrofit ledger is and its ceiling
```

## Status

Prototype. The interaction model and the pipelines are settled. Live capture's design and its
three hooks are **built and registered**; what remains unproven is end-to-end:

- **Live capture, not yet exercised for real.** `observe-edit` is confirmed against real Claude
  Code hook payloads; `record-approval` and `reconcile-stop` are wired but haven't fired in a
  live plan-approval / session-end round trip, and no full ticket has been run through
  `/proof:decision-log` end to end (Phase 4 in [`.plans/live-decision-capture.md`](.plans/live-decision-capture.md)).
  A dry run against a synthetic ticket confirmed the payoff: the live ledger captured a
  mid-execution deviation's *reason* and a declined alternative that a retrofit of the same PR
  couldn't recover at all.
- **Delivery.** GitHub serves committed HTML as `text/plain`, so a committed walkthrough isn't
  viewable in the PR. CI works around it with a downloadable artifact plus a comment link; a
  hosted renderer shipping only per-PR JSON is the likely long-term answer.
- **Verification in CI.** Reconstruct-from-diff has no author in the loop. Treat CI output as a
  draft until the author has reviewed it.
- **Reviewer affordances.** The walkthrough is read-only — marking a decision understood or
  disputed, weighting by blast radius, and stating what is *not* explained are not built.

See [`docs/design.md`](docs/design.md) for the full model and the settled-vs-open list.
