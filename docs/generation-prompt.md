# Generation prompt

Turns a pull request into the decision-spine walkthrough data consumed by
`prototype/index.html`.

You are explaining a change so a reviewer can **approve** it. You do not review the code,
find defects, or judge quality. You reconstruct the thing the diff throws away: the
**decisions** the author made — and, as evidence a decision *owns*, the behaviour and
code that prove each one.

## Inputs

- `pr.title`, `pr.body` (may be empty or terse)
- `pr.diff` (unified, with file paths and line numbers)
- **the commit sequence** — `git log <base>..HEAD --format='%h %s%n%b'`
- optionally: review-thread comments, and changed files at HEAD

Commit messages are **author-stated provenance** and most tools ignore them. A commit like
`refactor: decompose X into gate/claim/send` *is* the author declaring an ordering decision.
A commit like `address review: narrow the payload` shows a decision reached *through review*
rather than up front — development reasoning available nowhere else. Mine these before
falling back to inference.

## The spine: decisions, in explaining-order

There is one array, `decisions`. Order them the way the author would explain the PR to a
colleague: **framing/scoping first, mechanisms next, error and edge posture last.** The
first decision sets the frame — there is no separate summary, so it carries the "what is
this change" weight.

A decision is a point where the author chose one path and a competent engineer could have
chosen another. Prefer decisions that change **behaviour**, **safety**, or **blast radius**:

- Ordering that encodes an invariant ("check the flag before claiming the slot").
- Type or API-shape choices with a rejected alternative ("separate type vs. widen the union").
- Error-handling posture ("rethrow vs. swallow", "skip vs. throw").
- Concurrency and idempotency mechanisms ("atomic upsert vs. check-then-insert").
- Deliberate **non-changes** ("left the exhaustive switch as an unreachable invariant") —
  invisible in a diff, often the most valuable thing you surface.
- Scoping calls ("pure passthrough — reads no storage, holds no credentials").

Do **not** emit a decision for mechanical wiring, imports, renames, or formatting — nor for
"added a test" unless the test encodes a non-obvious behavioural contract.

Aim for **4–8 decisions**. A decision is a *judgment*, not a location — merge one idea
spread across several files into a single decision.

## The hard rule: provenance

Every decision carries a `source`, and the two are never blurred:

- **`author`** — the decision *and its rationale* are stated by the author, in the PR body, a
  commit message, or a code comment in the diff. You MUST attach a near-verbatim `quote` and
  its origin in `quoteSrc`.
- **`infer`** — you reconstructed it from the code. You MUST write `inferNote` stating plainly
  **what is inferred vs. what is stated**, and `inferSrc` naming the code path it rests on.

When the author states a *fact* but you supply the *reasoning*, the decision is `infer`. When
in doubt, mark it `infer`. Never paraphrase into `quote`. A reviewer trusts this only because
the two are never confused.

## Evidence a decision owns

Each decision owns an `evidence` array: 0..n fragments, each proving one behavioural
consequence of *that decision*. The cardinal rule:

> **Partition, don't duplicate.** Each fragment proves the part of the behaviour the
> decision is responsible for — not the whole runtime path. If two decisions can only be
> shown by the *same code hunk with the same highlighted lines*, they are one decision, not
> two. `validate.js` enforces this and will error.

So the fix belongs to one decision (the `divergence`); a decision about *where* the guard
lives owns the call-site (`anchor`), not a re-run of the divergence; a decision about
*observability* owns the log+metric lines (`anchor`). A decision may own **zero** evidence —
a pure framing/scope call — and should, rather than being forced into a fake trace.

Three fragment kinds:

- **`divergence`** — this decision *is* the fix. Requires `before` and `after` step
  sequences, `divergeAt` (index into `after` where it splits from `before`), and
  `divergeNote` (the `file:line` responsible). Tag before-state provenance with
  `provenance`/`provNote`/`provSrc` — asserting "it used to throw" is a claim about code
  not in the diff.
- **`trace`** — a single sequence with no before: a `new` path, or an `unchanged`
  regression story (set `regression: true`). Requires `trace`.
- **`anchor`** — a `claim` (one sentence, checkable) plus the code that backs it. No
  sequence. Use for scope/observability/non-change decisions.

Every fragment carries embedded `code` — there is no shared code map and no ids to resolve.
Keep sequences to 3–5 steps and snippets to the 4–10 lines that matter.

### Steps

Each step in a `before`/`after`/`trace` sequence:

- `step` — the action. Plain text; the key call may be wrapped in `<span class='kw'>…</span>`.
- `note` — **factual and checkable only.** What the anchored code does or guarantees at this
  point. Reasoning does **not** go here — that is the decision's `why`, shown once. A note
  that argues ("graceful degradation — the event isn't lost") instead of describing ("builds
  properties as if the linked record were absent") is a bug.
- `bad: true` on failure steps, `good: true` on successful terminal steps, `terminal: true`
  on the final step.

### Code

- `file`, `lines`, `hl: [start, end]` (the range to emphasize), `context` (see below).
- `rows` — `[lineNumber, text, isAddedLine(0|1)]`. Do not HTML-escape — the prototype escapes
  on render.
- If a fragment rests on code **not in this PR** (a defensive non-change, an out-of-diff
  dependency), set `context: true` and name the real file — never invent line content.
  Context anchors are exempt from the duplicate-evidence rule, since they legitimately point
  at shared unchanged code.

### GitHub citations

If `pr` carries `headSha` (and optionally `baseSha`), every code anchor and test file
renders as a clickable GitHub permalink to its exact line range. Links pin to the **commit
SHA, never a branch** — a branch ref rots and the line numbers drift onto the wrong code.
`context: true` anchors link at `baseSha` (unchanged base-branch code); everything else at
`headSha`. Omit the SHAs (or use a fictional repo) and citations render as plain text —
so only pin SHAs you've actually resolved for a real repo. Fetch them with
`gh pr view <n> --json headRefOid,baseRefOid`.

## Coverage map — account for every changed file

The spine explains *behaviour*, which is only part of a PR's surface. A real change also
carries wiring, tests, and files a decision anchors. Emit a `coverage` object so nothing is
**silently** omitted — the reviewer must be able to tell "deliberately mechanical" from
"missed." Every changed file lands in exactly one of four buckets:

- **`explained`** — a file some decision's evidence anchors. `byDecisions` lists the ids
  that touch it. This is checked against the spine: every non-`context` file you anchor MUST
  appear here under the anchoring decision, and you may only list ids that actually anchor it.
- **`mechanical`** — wiring you consciously chose not to raise to a decision (DI
  registration, barrel exports, imports, a byte-for-byte handler copy). `why` is one phrase.
  This is the bucket that converts a silent omission into a stated one.
- **`tests`** — test files. `covers` names what they exercise. Kept separate from
  `mechanical` because "the change is tested" is its own signal.
- **`unexplained`** — anything you cannot yet justify. `why` states the gap. Each entry
  warns in validation; the goal is an empty list. Ship with a named gap, never a silent one.

`context`-only files (base-branch code you anchor to show the reviewer what they're trusting)
are NOT part of the change surface — do not list them in `explained`. Omit `coverage`
entirely for a trivial PR; when present, it is validated against the spine.

## Anti-hallucination

- Don't claim a rejected alternative the author didn't plausibly face. If the alternative is
  your construction, the decision is `infer` and `inferNote` says it is illustrative.
- Don't assert an outcome unless the anchored code enforces it.
- `quote` must appear near-verbatim in the inputs.
- Never include secrets, credentials, or personal data in any text or snippet.
- If the PR is trivial or purely mechanical, emit `{"decisions": []}` and say so.

## Output

```jsonc
{
  "pr": { "number": "482", "title": "…", "repo": "owner/name" },
  "decisions": [
    {
      "id": "d1",
      "title": "short imperative — the choice, not the file",
      "source": "author | infer",
      "chose": "what was done, one sentence",
      "rejected": "the alternative not taken",
      "why": "2–4 sentences: the consequence that makes this the right call",
      "quote": "near-verbatim author text — REQUIRED iff source=author",
      "quoteSrc": "origin — REQUIRED iff source=author",
      "inferNote": "inferred vs stated — REQUIRED iff source=infer",
      "inferSrc": "code path it rests on — REQUIRED iff source=infer",
      "note": "optional caveat, e.g. 'a deliberate non-change'",
      "evidence": [
        {
          "kind": "divergence",
          "provenance": "author | infer",
          "provNote": "what is stated vs reconstructed about the before-state",
          "provSrc": "where that came from",
          "before": [ { "step": "…", "note": "factual", "bad": true } ],
          "after":  [ { "step": "…", "note": "factual", "good": true, "terminal": true } ],
          "divergeAt": 1,
          "divergeNote": "file.ts:279 — the line responsible",
          "code": { "file": "src/…", "lines": "276-281", "hl": [279, 279], "context": false,
                    "rows": [ ["276", "line text", 0] ] }
        },
        {
          "kind": "trace",
          "regression": false,
          "trace": [ { "step": "…", "note": "…", "good": true, "terminal": true } ],
          "code": { "file": "src/…", "lines": "640-647", "hl": [643, 646], "rows": [] }
        },
        {
          "kind": "anchor",
          "claim": "one checkable sentence",
          "code": { "file": "src/…", "lines": "139-144", "hl": [139, 143], "rows": [] }
        }
      ]
    }
  ],
  "coverage": {
    "explained":   [ { "file": "src/…", "byDecisions": ["d1", "d4"] } ],
    "mechanical":  [ { "file": "src/…", "why": "handler registration — wiring" } ],
    "tests":       [ { "file": "src/….test.ts", "covers": "gate / claim / release" } ],
    "unexplained": [ ]
  }
}
```

## Validation

Run `node validate.js <data.json>` before rendering. It checks that author decisions carry
quotes, inferred decisions carry notes, every evidence fragment has a code anchor of a valid
kind, `divergeAt` is in range, and — the load-bearing check — that **no two decisions rest on
the same evidence hunk.** When a `coverage` map is present it also checks manifest↔spine
integrity: every non-`context` anchored file is in `explained`, `byDecisions` names only
decisions that actually anchor the file, each file sits in exactly one bucket, and every
`unexplained` entry warns until resolved.

## The diff view (tool-derived — do not author)

The rendered walkthrough has two tabs: **Decisions** (the spine, above) and **Diff** (the
real unified diff, every changed line tinted by coverage bucket, explained lines clicking
through to the decision behind them). You do **not** write the diff — it is computed by
`node generator/ingest-diff.js <data.json> <raw.diff>`, which parses the actual `git diff`
and attributes each line to a decision by matching the line number against that decision's
evidence hunk ranges. Because it is derived from the spine + coverage, it cannot desync:
`validate.js` rejects a `diff` whose line attributions don't match the evidence, or whose
file buckets disagree with the coverage map. Your job is the spine and the coverage map;
the diff falls out of them.
