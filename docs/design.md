# Design

## The problem

PR review is **linear** — file-by-file diffs — but a change is **causal**: "added X because Y,
which forced Z." A diff shows the *outcome* of every decision and preserves none of the
reasoning. The reviewer reconstructs it in their head, every time, for every PR.

Two things get lost that a reviewer actually needs:

- **Behaviour** — what the code does at runtime. You approve behaviour, not structure.
- **Reasoning during development** — the judgment calls. "I used a separate type instead of
  widening the union, because widening breaks narrowing." That evaporates on merge.

## What this is not

Not a defect finder. `proof` explains a change so a reviewer can approve it with confidence.
Static analysis and existing review tools already hunt for bugs; nothing here scores quality
or suggests improvements.

Notably, the **dependency graph is deliberately absent**. Structure is recoverable — an LSP
or tree-sitter can rebuild "X imports Y" without an LLM. Reasoning cannot be recovered, so
that is where the effort goes.

## Two tracks, one at a time

The reviewer toggles between two peer views. They are not nested — each owns the full canvas
when active.

### Behaviour track (the default entry)

PR-scoped: only the paths this change affects. Landing on behaviour means the reviewer's
first screen is something *checkable against code*, not a claim they must trust.

Each path is classified:

| Class | Meaning |
|---|---|
| `CHANGED` | Behaved one way before, another now. Where risk lives. |
| `NEW` | A path that did not exist before. |
| `UNCHANGED` | Touched code, same behaviour. The regression story. |

`CHANGED` paths render as **before/after side by side** with an explicit **divergence
marker** naming the hop where the two paths split. For a bugfix, that marker is the fix.

Paths are shown as an accordion — with 3–6 paths typical for a single PR, a master/detail
split buys nothing, and a single column lets the reviewer see the whole shape of the change
at once.

### Decision track

The author's judgment calls, in the order they would explain them: framing and scoping
first, mechanisms next, error and edge posture last.

Each decision carries what was **chosen**, what was **rejected**, and **why it matters** —
the consequence that makes it the right call. Deliberate *non-changes* count as decisions
and are often the most valuable thing surfaced, because a diff cannot show them.

## Provenance is the load-bearing rule

Every claim is one of two things, and they are never blurred:

- **author-stated** — the decision *and its rationale* come from the PR body, a commit
  message, or a code comment. Requires a near-verbatim quote and its source.
- **AI-inferred** — reconstructed from the code. Requires a note stating plainly what is
  inferred versus what is stated, and the code path the inference rests on.

When the author states a *fact* but the reasoning is reconstructed, the decision is
**inferred**. When in doubt, mark it inferred.

This is what makes the artifact safe to approve from. A tool that makes a reviewer confident
via reasoning that is subtly wrong is worse than a raw diff, because the reviewer stops
looking. Before-state claims on `CHANGED` paths are tagged the same way — asserting "it used
to throw" is a claim about code not in the diff.

Code outside the PR is anchored but marked **context, not under review**. Surfacing an
out-of-diff dependency is a feature: it tells the reviewer they are being asked to trust
something they cannot see.

## The trace is the code path

A faithful execution trace already shows how control flows, anchored to real lines. There is
no separate call-graph build — the structural axis comes free from the behaviour axis. This
was the expensive piece in early designs and it turned out to be unnecessary.

## Crossover is the connective tissue

With one track visible at a time, the *transition* is the most important interaction — the
only place the two tracks touch.

- Behaviour hops carry a `why?` link instead of inline rationale, so the tracks never
  duplicate content.
- Crossing over **carries context**: it lands on the specific decision or hop, not the top of
  the other track.
- It **leaves a breadcrumb back**, so crossing over is not a commitment.
- When the mapping fans out one-to-many, it offers a choice rather than silently picking.

A hop with reasoning shows a small accent dot, so the reviewer can see *where* the decisions
are without reading a label on every step.

One consequence worth noting: **deliberate non-changes have no after-behaviour to link to.**
"Left the exhaustive switch alone" links only to the *before* path, because that is the only
place the switch ran. Honest, and caught by validation rather than papered over.

## The author is the first verifier

The intended flow is generate → **author corrects** → publish. The author is in the loop
before any reviewer sees it, so every inferred decision they confirm becomes author-stated,
and anything wrong gets fixed in one pass. The generator is a drafting tool, not an
authority — which is the right role for it, and it makes the walkthrough cheaper to produce
than a long PR description.

## Settled vs. open

**Settled:** two tracks, one at a time; behaviour-first; PR-scoped; decisions with rejected
alternatives; the provenance split; trace-as-code-path; author verifies before publishing.

**Open:**

- **Delivery.** GitHub serves committed HTML as `text/plain`, so a committed artifact is
  distributed but not viewable in the PR. Candidates: CI artifact plus a PR comment link, a
  markdown rendering in the PR itself, or a hosted app where only the per-PR data ships.
  Content should prove itself before infrastructure is built.
- **Reviewer affordances.** The reviewer can currently only read. Marking a decision
  understood or disputed, and anchoring a question to a trace hop, is the largest functional
  gap.
- **Weight.** All decisions render equally, though blast radius differs enormously. A
  reviewer with ten minutes needs to know where to spend them.
- **Coverage.** Nothing states what is *not* explained, so silence is ambiguous — a reviewer
  cannot tell "safe" from "unexamined."
- **Audience split.** One artifact serves engineers and non-engineers. Progressive
  disclosure is the likely answer, but it is unproven.
