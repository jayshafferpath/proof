# proof

A visual walkthrough that explains the **decisions** behind a change and the **code paths**
they produce, so review is about judgment rather than reconstruction.

A diff shows the outcome of every decision and preserves none of the reasoning. `proof`
recovers the two things that get lost — what the author decided, and what the code actually
does at runtime — and keeps every claim anchored to real lines.

It explains. It does not hunt for defects.

## Try it

```sh
open prototype/index.html
```

No build step, no dependencies, no server. The page is self-contained and ships with a
sample walkthrough for a fictional bugfix.

What to look at:

1. It opens on **Behaviour** — three runtime paths, each classified `CHANGED` / `NEW` /
   `UNCHANGED`, so the shape of the change reads at a glance.
2. The `CHANGED` path shows **before and after side by side**, with a divergence marker
   naming the line where they split. On a bugfix, that line is the fix.
3. Hover or click a step for its rationale; a small accent dot marks steps that have a
   decision behind them. Click **why?** to cross into the decision track.
4. The **Decisions** track shows what was chosen, what was rejected, and why — each tagged
   **✎ author-stated** (with a verbatim quote) or **⚙ AI-inferred** (with a note on what is
   reconstructed). Cross back via *Behaviour it shapes*.

## How it works

```
PR diff + body + commit messages
        │
        ▼  docs/generation-prompt.md
   walkthrough data (JSON)
        │
        ▼  node validate.js       (provenance + evidence checks)
        │
        ▼  node generate.js       (data + generator/style.css)
   prototype/index.html  ← self-contained, opens anywhere
```

The generator drafts; **the author verifies before publishing**. Every inferred decision the
author confirms becomes author-stated. The model is a drafting tool, not an authority.

## The rule that matters

Every claim is either the author's own words or explicitly marked as reconstruction — never
blurred. A tool that makes a reviewer confident via reasoning that is subtly wrong is worse
than a raw diff, because the reviewer stops looking.

`validate.js` enforces this mechanically: author-stated decisions must carry a quote,
inferred ones must carry a note on what is inferred, every code anchor must resolve, and
every cross-link must be symmetric.

## Two ideas worth stealing

**The trace is the code path.** A faithful execution trace already shows control flow,
anchored to real lines — so there is no call-graph to build. The structural view comes free
from the behaviour view.

**Deliberate non-changes are decisions.** "Left the exhaustive switch alone, as an
unreachable invariant" is invisible in a diff and often the most valuable thing to surface.

## Layout

```
prototype/
  index.html            generated walkthrough (open directly)
  data/sample-fix.json  sample walkthrough data (decision-spine)
generator/
  style.css             the artifact's stylesheet, inlined at generate time
generate.js             renders data → self-contained index.html
validate.js             enforces the provenance and evidence rules
docs/
  design.md             the model, and what is settled vs. open
  generation-prompt.md  the prompt that produces walkthrough data
```

## Status

Prototype. The interaction model is settled; delivery is not — GitHub serves committed HTML
as `text/plain`, so getting this in front of reviewers needs either a CI artifact, a markdown
rendering, or a hosted app. See *Settled vs. open* in [docs/design.md](docs/design.md).

The largest functional gap: a reviewer can currently only read. Marking a decision understood
or disputed, and anchoring a question to a step, is not built.
