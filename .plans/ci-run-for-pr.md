# Plan: run `proof` for a PR in CI

## Goal

On a pull request, generate a decision-spine walkthrough with Claude, validate it,
render the HTML, and deliver it to the reviewer — reusing the org's proven
Bedrock-in-CI pattern. Self-contained in the first target repo; not yet a shared action.

## Decisions locked (from Jay)

- **Delivery (v1):** HTML uploaded as a CI **artifact** only. No markdown-digest comment
  yet, no hosted app. (Hosted app deferred per design.md "prove content first.")
- **On validation failure:** do **not** render or upload. Post `validate.js`'s errors as a
  PR comment so the author can fix the prompt/data. Early runs are treated as drafts.
- **Packaging:** vendor the node scripts + workflow into the **target repo** (fastest to a
  live run). Reusable action is a later extraction, not this plan.

## Reuse from pathccm/shared-github-actions (see memory: org-claude-ci-invocation)

The `ai-pr-review` action already solves the hard parts — copy, don't reinvent:

- **Auth:** AWS Bedrock via OIDC, no API-key secret. `aws-actions/configure-aws-credentials@v4`
  assuming a role, `CLAUDE_CODE_USE_BEDROCK=1`, region `us-west-2`.
- **CLI:** `npm install -g @anthropic-ai/claude-code@2.1.219`; Node 24 via `actions/setup-node@v4`.
- **Invocation:** prompt piped to
  `claude -p --bare --verbose --tools "" --effort medium --output-format stream-json`,
  wrapped in `timeout -k 30s 600s`.
- **Result extraction:** `jq -r 'select(.type=="result" and .subtype=="success") | .result'`.
- **PR comment:** the reusable `post-pr-comment` action upserts by an HTML-comment marker
  (used here for the *error* comment, so re-runs replace it rather than pile up).

### The IAM blocker to resolve first

The `role/ai-pr-review` model allowlist is enforced by IAM (`bedrock:InvokeModel`) and
is scoped to the `ai-pr-review` use. proof needs **either**:
- permission to assume that same role from a proof workflow, **or**
- a sibling IAM role for proof with the same Bedrock model grants.

This is a prerequisite, not code. Flag to whoever owns the atmos `iam-role/ai-pr-review`
stack. Until resolved, the workflow can be validated end-to-end locally (steps 1–5 below
run without CI), but the CI job can't call Bedrock.

## Pipeline (5 steps; only step 2 is the model)

```
1. gather   gh pr view <n> --json title,body,headRefName,baseRefName,headRefOid,baseRefOid
            git log base..head, git diff base..head           → inputs
2. generate docs/generation-prompt.md + inputs → claude       → data.json  (the .result)
3. ingest   node generator/ingest-diff.js data.json raw.diff  → data.json (+diff field)
4. validate node validate.js data.json    exit 0=valid / 1=errors(stdout)
5. render   node generate.js data.json out.html               → self-contained HTML
```

Steps 1,3,4,5 are pure scripts (only `fs`/`path`, zero npm deps). Step 2 is the Claude call.

## What to build

### A. `proof.sh` — one driver script (vendored into target repo)

Wraps steps 1–5. Takes a PR number. Assembles the prompt exactly as `ai-pr-review` does
(prompt file + fenced, untrusted PR title/body + fenced diff + inlined commit log), pipes
to `claude`, extracts `.result` into `data.json`, then runs ingest → validate → (render |
error-comment). Local-runnable for prompt tuning before CI exists.

Prompt assembly notes:
- Inline `git log <base>..HEAD --format='%h %s%n%b'` — the generation prompt explicitly
  mines commit messages as author-stated provenance.
- headSha/baseSha from `gh pr view` feed `pr.headSha`/`pr.baseSha` so citations become
  real GitHub permalinks (generate.js `ghUrl`). Must be injected into the JSON `pr` object
  — either the prompt is told to emit them, or the script patches them post-generation
  (more reliable: patch, don't trust the model to echo SHAs).

### B. `.github/workflows/proof.yml` — the CI job

- Trigger: `pull_request` (opened, synchronize). Concurrency-cancel in-progress per PR.
- Permissions: `contents: read`, `pull-requests: write`, `id-token: write`.
- Steps: checkout (fetch-depth 0) → OIDC creds → setup-node 24 → install CLI → run `proof.sh`.
- Branch on `validate.js` exit code:
  - **0:** `actions/upload-artifact` with `out.html`; optionally a comment linking the
    run's artifacts page.
  - **1:** capture stdout errors, post via `post-pr-comment` with a proof marker
    (`<!-- proof-walkthrough -->`) so the next push replaces it.
- Size gate (mirror ai-pr-review): skip huge PRs with an explanatory comment.
- `continue-on-error: true` at job level so a proof failure never blocks the PR check.

## Open questions / risks

1. **Artifact UX is genuinely clunky** (download → unzip → open). Accepted for v1, but the
   markdown-digest comment (deferred) is the obvious next lever — it's where the *reasoning*
   would land inline. Worth revisiting after one real run.
2. **Model choice.** ai-pr-review defaults to Sonnet 4.6 [1m]. Generation here is a
   structured-output task with a long, exacting schema — may want Opus. Constrained by
   whatever the IAM role's allowlist permits.
3. **Non-determinism vs. the provenance contract.** validate.js is the safety net, but a
   model that fabricates a `quote` passes validation (the quote exists in the JSON; validate
   only checks it's *present*, not that it's *verbatim in the inputs*). The design leans on
   "author verifies before publishing" — CI has no author-in-the-loop. This is the deepest
   tension: CI auto-generation removes the human verifier the whole model assumes. v1
   artifact-only + draft framing is defensible; a "generated, unverified" banner in the
   output would make the missing verification honest.

## Sequencing

1. Resolve IAM (parallel, not blocking local work).
2. Build + test `proof.sh` locally against pr-1227 (known-good data exists to diff against).
3. Add `proof.yml`, dry-run on a throwaway PR in the target repo.
4. One real PR; evaluate output quality and the verification-gap risk before wider rollout.
