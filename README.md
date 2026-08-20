# proof

`proof` generates a self-contained HTML walkthrough of a pull request. The walkthrough
records two things a unified diff discards: the **decisions** the author made, and the
**runtime behaviour** those decisions produce. Every claim is anchored to a real line and
tagged with its provenance — the author's own words, or a reconstruction from the code.

`proof` explains a change so a reviewer can approve it. It does not find defects, score
quality, or suggest improvements.

## Requirements

- `node` (no `npm install`; the only dependency, EJS, is committed at `generator/vendor/ejs.js`)
- `gh` authenticated against the target repo (for `proof.sh`)
- `jq` (for `proof.sh`)
- `claude` CLI with AWS Bedrock access (for live generation; not needed with `--data`)

## Usage

Generate a walkthrough for a pull request:

```sh
./proof.sh <pr-number> [--repo owner/name]
```

The repo defaults to the current checkout (or `$GITHUB_REPOSITORY` in CI). Output is written
to `prototype/pr-<n>.html`, which opens in any browser with no server or build step.

### Flags

| Flag | Default | Description |
|---|---|---|
| `--repo owner/name` | current checkout | Target repository. |
| `--data file.json` | — | Inject pre-generated walkthrough JSON and skip the model call. Used for prompt tuning and for running the mechanical pipeline without Bedrock credentials. |
| `--model id` | `us.anthropic.claude-sonnet-4-6[1m]` | Bedrock inference profile. Must be permitted by the assumed IAM role. |
| `--prompt file` | `docs/generation-prompt.md` | Generation prompt. |
| `--out dir` | `prototype` | Output directory. |
| `--keep-tmp` | off | Retain the temp working directory for inspection. |

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Valid walkthrough rendered to `<out>/pr-<n>.html`. |
| `1` | Validation failed. Errors are printed to stdout; nothing is rendered. |
| `2` | Usage or precondition error. |
| `3` | Generation produced no usable JSON (auth, backstop timeout, or parse failure). |

## Pipeline

`proof.sh` runs five stages. Only stage 2 calls a model; the rest are pure node scripts.

```
1. gather    gh pr view / gh pr diff              → title, body, diff, commit SHAs
2. generate  prompt + inputs → claude (Bedrock)   → walkthrough JSON
3. ingest    node generator/ingest-diff.js        → attribute each diff line to a decision
4. validate  node validate.js                     → provenance, evidence, coverage checks
5. render    node generate.js                      → self-contained pr-<n>.html
```

The `pr` object (number, title, repo, headSha, baseSha) is overwritten from resolved `gh`
facts after generation rather than trusted from the model, because code citations pin to the
SHAs and a wrong SHA links to the wrong code. Author-controlled text (title, body, diff) is
fenced with dynamic backtick runs to prevent a crafted description from posing as prompt
structure.

The stages can also be run individually:

```sh
node generator/ingest-diff.js <data.json> <raw.diff> [out.json]
node validate.js <data.json>
node generate.js <data.json> [out.html]
```

## The rendered walkthrough

The page has three tabs. It opens on **Behaviour**, so the reviewer's first screen is
checkable against code rather than a claim to be trusted.

- **Behaviour** — each runtime scenario the change touches, classified `CHANGED`, `NEW`, or
  `UNCHANGED`. `CHANGED` scenarios render before and after side by side with a divergence
  marker naming the `file:line` where the two paths split; on a bugfix, that line is the fix.
- **Decisions** — what the author chose, what they rejected, and why. Each decision is tagged
  **author-stated** (with a verbatim quote and its source) or **AI-inferred** (with a note on
  what is reconstructed). Deliberate non-changes count as decisions.
- **Diff** — the real unified diff, each line tinted by its coverage bucket. Explained lines
  link to the decision behind them. The diff is computed from the spine and coverage map, so
  it cannot desync from the decisions.

Behaviour and Diff are derived from the decisions and their evidence — never authored
separately. When a PR has no runtime scenarios (a pure framing or scope change), the
Behaviour tab is absent and the page opens on Decisions.

## Provenance and validation

Every claim is one of two kinds, never blurred:

- **author-stated** — the decision and its rationale come from the PR body, a commit message,
  or a code comment. Requires a near-verbatim quote and its source.
- **AI-inferred** — reconstructed from the code. Requires a note stating what is inferred
  versus what is stated, and the code path the inference rests on.

`validate.js` enforces this mechanically and exits non-zero on any violation: author-stated
decisions must carry a quote, inferred decisions must carry a note, every evidence fragment
must resolve to a valid code anchor, `divergeAt` must be in range, and no two decisions may
rest on the same evidence hunk. When a coverage map is present, it also checks that every
non-context anchored file is accounted for in exactly one bucket (explained, mechanical,
tests, or unexplained) and that the diff attribution agrees with the spine.

The intended flow is generate → author corrects → publish. The generator drafts; the author
is the first verifier. An inferred decision the author confirms becomes author-stated.

## CI

`.github/workflows/proof.yml` runs the pipeline on `pull_request`. It authenticates to AWS
Bedrock via OIDC (no API-key secret), runs `proof.sh`, and branches on the exit code:

- **0** — uploads the rendered HTML as a build artifact and posts a PR comment linking it.
- **1** — posts the validation errors as a PR comment so the author can fix the data.

Both comments upsert by a hidden marker (`.github/upsert-comment.sh`), so re-running on a new
push updates one comment rather than accumulating. A failed run never blocks the PR check
(`continue-on-error`). The workflow requires the assumed IAM role to permit `bedrock:InvokeModel`
on the chosen model; see `.plans/ci-run-for-pr.md`.

## Retrofit — from a decision ledger instead of the model

An alternative to reconstructing decisions from the diff: a **decision ledger**
(`proof.ledger/v1`, append-only JSONL) records decisions as events, which reduce into a
walkthrough spine (`proof.spine/v2`). A ledger can be **retrofit** from a finished PR's
artifacts — reconstructed after the fact, so it is honestly capped at `through-review`
provenance and never claims first-hand (see `docs/retrofit-ledger.md`).

```sh
# 1. produce the ledger from a PR's artifacts (interpretive — the /retrofit-ledger skill)
# 2. render it (deterministic):
./retrofit.sh prototype/data/pr-<n>.ledger.jsonl <pr-number> --repo owner/name
```

`retrofit.sh` pulls the PR's own diff (base-pinned via `gh pr diff`, immune to local rebase
drift), attributes it, enriches `pr` with live repo/base/head SHAs, validates against
`proof.spine/v2`, and renders. The walkthrough opens on **Decisions** with a **Diff** tab;
Behaviour is absent until decisions carry runtime steps (live capture). Contracts and the
machine-readable schemas live in `docs/contracts.md` and `schemas/`.

To use `/retrofit-ledger` from any repo, install the skills globally and point `PROOF_HOME`
at this checkout:

```sh
./install.sh                        # symlinks .claude/skills/* into ~/.claude/skills/
export PROOF_HOME="$(pwd)"          # so the skill finds retrofit.sh / generator/ from elsewhere
```

## Layout

```
proof.sh                       reconstruction pipeline (gather → generate → ingest → validate → render)
retrofit.sh                    ledger pipeline (reduce → ingest gh pr diff → validate → render)
build.sh                       regenerate the sample walkthroughs from prototype/data
install.sh                     symlink/copy .claude/skills/* into the global Claude skills dir
generate.js                    loads templates + assets, renders data → self-contained HTML (spine v1 + v2)
validate.js                    enforces provenance, evidence, coverage; contract-versioned
generator/
  templates/*.ejs              page shell + card/coverage/behaviour/diff markup
  client.js                    client-side behaviour (tabs, drawer, sort), inlined
  style.css                    stylesheet, inlined at generate time
  ingest-diff.js               attributes each diff line to a decision
  reduce-ledger.js             folds a decision ledger into a walkthrough spine
  ledger-cli.js                deterministic ledger writer (seq/id/commit/schema gate)
  contract.js                  wire-contract negotiation (proof.ledger, proof.spine)
  schema-check.js              zero-dep JSON Schema checker
  vendor/ejs.js                vendored EJS engine (committed; no npm install)
schemas/
  ledger.v1 / spine.v1 / spine.v2   machine-readable structural contracts
prototype/
  *.html                       generated walkthroughs — gitignored, run ./build.sh
  pr-277.html                  committed retrofit sample (spine v2, ledger-derived)
  data/*.json  data/*.ledger.jsonl   walkthrough data + ledgers (source of truth)
.claude/skills/
  retrofit-ledger/             skill: PR artifacts → by:retrofit ledger
.github/
  workflows/proof.yml          CI job
  upsert-comment.sh            marker-based PR comment upsert
docs/
  design.md                    the model; settled vs. open questions
  generation-prompt.md         the prompt that produces walkthrough data
  contracts.md                 versioned wire contracts + policy
  ledger-schema.md spine-schema.md   the two contract shapes, annotated
  retrofit-ledger.md           what a retrofit ledger is and its ceiling
```

## Status

Prototype. The interaction model and the pipeline are settled. The open questions are
delivery and verification:

- **Delivery.** GitHub serves committed HTML as `text/plain`, so a committed walkthrough is
  not viewable in the PR. CI works around this with a downloadable artifact plus a comment
  link. A hosted renderer that ships only per-PR JSON is the likely long-term answer.
- **Verification.** CI generation has no author in the loop. `validate.js` checks that a
  quote is present, not that it is verbatim in the inputs, so an unverified walkthrough can
  pass validation. Treat CI-generated output as a draft until the author has reviewed it.
- **Reviewer affordances.** The walkthrough is read-only. Marking a decision understood or
  disputed, and anchoring a question to a behaviour scenario, are not built.

See `docs/design.md` for the full model and the settled-vs-open list.
