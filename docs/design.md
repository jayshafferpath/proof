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

## One spine: decisions

The walkthrough is **one spine**, not two peer tracks. The spine is the author's judgment
calls, ordered the way the author would explain them to a colleague: framing and scoping
first, mechanisms next, error and edge posture last. Each decision carries what was
**chosen**, what was **rejected**, and **why it matters** — the consequence that makes it the
right call. Deliberate *non-changes* count as decisions and are often the most valuable thing
surfaced, because a diff cannot show them.

Behaviour and diff are not a second, co-equal track — they are **evidence a decision owns**,
never authored separately, so they cannot desync from the spine or duplicate its content.
That evidence renders as three views over the same data, each a different entry point:

- **Diff** — the real unified diff, every line tinted by the coverage bucket it falls in.
  Lookup order: *what → why* — a changed line links to the decision behind it.
- **Behaviour** — the runtime scenarios a decision's evidence proves, classified `CHANGED`
  (behaved one way before, another now — where risk lives), `NEW` (a path that did not exist
  before), or `UNCHANGED` (touched code, same behaviour — the regression story). `CHANGED`
  scenarios render **before/after side by side** with an explicit **divergence marker** naming
  the line where the two paths split; for a bugfix, that marker is the fix. A deliberate
  non-change has no after-behaviour to link to — it renders on the `before` path only, because
  that is the only place the code ran. Honest, and caught by validation rather than papered
  over.
- **Decisions** — reading order: *why → what*, the author's judgment calls in explaining
  order, each with its chosen/rejected/why and the evidence it owns inline.

The reviewer's first screen is whichever of these the PR actually has evidence for: the real
diff when one exists, the behaviour matrix when there are runtime scenarios but no diff, and
the decision list otherwise — never a claim to be trusted before the reviewer can check it
against code.

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

## The author is the first verifier

The intended flow is generate → **author corrects** → publish. The author is in the loop
before any reviewer sees it, so every inferred decision they confirm becomes author-stated,
and anything wrong gets fixed in one pass. The generator is a drafting tool, not an
authority — which is the right role for it, and it makes the walkthrough cheaper to produce
than a long PR description.

## Settled vs. open

**Settled:** one decision spine, not two peer tracks; diff-first landing, falling back to
behaviour then decisions; PR-scoped; decisions with rejected alternatives; the provenance
split; trace-as-code-path; behaviour and diff derived from decisions, never authored
separately; author verifies before publishing; generation backend is pluggable and
auto-detected from what's on PATH (`aws` → bedrock, else `opencode`; override with
`--backend`, see `proof.sh`) rather than hardcoded to one provider.

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

## History

The first design (Aug 2026) had two peer tracks — Behaviour and Decisions — joined by a
crossover interaction (a `why?` link, breadcrumb-back navigation, fan-out choice). It was
superseded by the single decision spine described above once the two tracks proved to
duplicate content rather than stay orthogonal: see `.plans/merge-tracks.md` (the case against
two tracks) and `.plans/decision-spine.md` (the spine that replaced them). The Diff tab is
the spine's inverse index, added afterward: see `.plans/diff-tab.md`.
