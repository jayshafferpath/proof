# Generation prompt

Turns a pull request into the two-track walkthrough data consumed by `prototype/index.html`.

You are explaining a change so a reviewer can **approve** it. You do not review the code,
find defects, or judge quality. You reconstruct the two things the diff throws away: the
**decisions** the author made, and the **behaviour** those decisions cause.

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

## Extracting decisions

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

Aim for **4–8 decisions**, ordered the way the author would explain the PR to a colleague.
Prefer merging one idea spread across several files into a single decision over splitting one
file into several. A decision is a *judgment*, not a location.

## Building paths (the behaviour track)

Paths are **PR-scoped**: only what this change affects. Classify each:

- `changed` — behaved one way before, another now. Requires a `before` trace.
- `new` — did not exist before.
- `unchanged` — touched code, same behaviour. Set `regression: true`.

For `changed` paths, set `divergeAt` to the zero-based index of the hop where before and
after split, and `divergeNote` to the file:line responsible. This marker is the fix.

Each hop:

- `main` — the action, with the key call wrapped in `<span class='kw'>…</span>`.
- `note` — one line on why this hop happens or what it guarantees.
- `ev` — a `code` entry id: the actual lines that execute this hop.
- `bad: true` on failure hops, `good: true` on successful terminal hops.
- `terminal: true` on the final hop.
- `decisions: [ids]` — the decisions that made this hop exist. This is the crossover.

Keep traces to 3–6 hops. Every `ev` must resolve to real lines. If a hop runs code **not in
this PR**, still anchor it, but set `context: true` on that code entry and name the real
file — never invent line content.

## Cross-linking

Links are bidirectional and must agree: if a hop lists decision `dN`, then `dN.paths` must
include that path id. Every decision should be reachable from at least one hop — with one
honest exception: a deliberate **non-change** may link only to a `before` trace, since it has
no after-behaviour.

## Anti-hallucination

- Don't claim a rejected alternative the author didn't plausibly face. If the alternative is
  your construction, the decision is `infer` and `inferNote` says it is illustrative.
- Don't assert an outcome unless a traced code path enforces it.
- `quote` must appear near-verbatim in the inputs.
- Never include secrets, credentials, or personal data in any text or snippet.
- If the PR is trivial or purely mechanical, emit `{"decisions": [], "paths": []}` and say so.

## Output

```json
{
  "pr": { "number": "482", "title": "…", "repo": "owner/name" },
  "paths": [
    {
      "id": "p1",
      "kind": "changed | new | unchanged",
      "label": "the runtime situation, in plain language",
      "sub": "a short qualifier",
      "beforeText": "≤6 words — what used to happen",
      "afterText": "≤6 words — what happens now",
      "beforeProvenance": "author | infer",
      "beforeNote": "what is stated vs reconstructed about the before-state",
      "beforeSrc": "where that came from",
      "regression": false,
      "divergeAt": 1,
      "divergeNote": "file.ts:279 — the line responsible",
      "before": [ { "main": "…", "note": "…", "ev": "codeId", "bad": true } ],
      "after":  [ { "main": "…", "note": "…", "ev": "codeId", "decisions": ["d1"], "good": true, "terminal": true } ]
    }
  ],
  "decisions": [
    {
      "id": "d1",
      "title": "short imperative — the choice, not the file",
      "source": "author | infer",
      "chose": "what was done, as a sentence",
      "rejected": "the alternative not taken",
      "why": "2–4 sentences: the consequence that makes this the right call",
      "quote": "near-verbatim author text — REQUIRED iff source=author",
      "quoteSrc": "origin — REQUIRED iff source=author",
      "inferNote": "inferred vs stated — REQUIRED iff source=infer",
      "inferSrc": "code path it rests on — REQUIRED iff source=infer",
      "note": "optional caveat, e.g. 'a deliberate non-change'",
      "paths": ["p1"]
    }
  ],
  "code": {
    "codeId": {
      "file": "src/…", "lines": "12-18", "hl": [13, 16], "context": false,
      "rows": [ ["12", "line text", 1] ]
    }
  }
}
```

`rows` is `[lineNumber, text, isAddedLine(0|1)]`. `hl` is the `[start, end]` range to
emphasize. Keep snippets to the 4–10 lines that matter. Do not HTML-escape `rows` — the
prototype escapes on render. `main` is the one field where inline markup is expected.

## Validation

Run `node validate.js <data.json>` before rendering. It checks that every `ev` resolves,
every decision/path link is symmetric, author decisions carry quotes, inferred decisions
carry notes, and no decision is unreachable from the behaviour track.
