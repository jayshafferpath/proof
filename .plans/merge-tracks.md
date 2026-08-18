# Plan: merge the two tracks into one decision-first walkthrough

## Why

The Behaviour pane doesn't carry its weight because it applies uniform 3–6 hop
machinery to paths that need a paragraph (CHANGED) and paths that need a line
(NEW/UNCHANGED), and — worse — its hop `note`s smuggle decision *reasoning* into
the track that design.md sells as "checkable against code," with **no provenance
tagging** and no validation. The two tracks were never cleanly orthogonal; the
behaviour notes duplicate the decisions' theses.

Merging into one **decision-first** view resolves both: every behavioural claim
sits under the decision that produced it, which already carries author/infer
provenance. The many-to-many path↔decision mapping (which forced the crossover
machinery) dissolves — each decision owns exactly the behavioural fragment it
causes.

## Correction to the merged unit (path-anchored, not decision-anchored)

Decision-first splinters the one path that matters: p1 (CHANGED) is shaped by
d1, d2, d4, d5 — making decisions the spine scatters its single before/after
divergence across four cards, and a strip + six trace-carrying cards is *more*
surface than today. So the merge is **path-anchored with decisions inline**:

One scrollable view, no track toggle:

1. **Change-shape strip** (always visible): one line per path — kind badge +
   `beforeText → afterText`. The at-a-glance the old accordion never gave at rest.
2. **Path sections**, each the existing trace (CHANGED keeps before/after +
   `:279` divergence intact). At each hop that has `decisions: [ids]`, the
   decision(s) render **inline and expanded** right there — provenance chip,
   `chose`/`instead of`/`why`, quote/infer box — instead of a "why?" link that
   crosses to another view. Reasoning sits exactly where its behaviour is.

This fully merges the tracks: separate Decisions view, track toggle, breadcrumb,
and all crossover machinery are deleted. It keeps the risky path whole, and it
closes the integrity gap — each provenance-carrying decision is attached to the
hop whose claim it justifies. A decision cited by multiple hops (rare) renders at
its first citing hop; a deliberate non-change (d5) sits on a `before` hop.

## Data model changes (`sample-fix.json`)

- **Structure is unchanged** — paths keep their `before`/`after` hop arrays,
  decisions keep `paths: [ids]`, hops keep `decisions: [ids]`. The merge is a
  *render* change, not a data migration.
- **Hop `note`s become strictly factual/checkable** — reasoning moves out (it is
  now shown inline via the decision's `why`). E.g. p1.after[2] note "the skip is
  observable, not silent" (that's d4's thesis) → "warn log + increment, then
  return". p2 note "graceful degradation…" → "builds properties as if linked
  absent". This is the honesty fix: hop notes assert only what the anchored code
  shows.
- Add `firstCite` handling implicitly (render logic, not data): no field needed.

## `validate.js` changes

- **Keep all existing checks** (author⇒quote, infer⇒note, ev resolves, symmetric
  links, reachability, divergeAt range). The model is unchanged.
- New check: every hop `note`, if present, must not… — *not* mechanically
  enforceable; instead add a warning when a decision's `why` text is a substring
  match / high-overlap with any hop note (best-effort dup detector). Keep it a
  warning, not an error.

## `index.html` changes

Delete: track toggle + trackbar, crumb + `crossToDecision`/`crossToPath`/`ret`/
`crumb-back`, the `.acc`/`.arow`/`.ahead` accordion, `.hlinks`/`.xlink` "why?"
links, `.hasWhy` dot, the 4-layer hover reveal on hops, the empty-evidence
placeholder. `setTrack` collapses away.

Keep + adapt: the hop/`.hdot`/`.hline` rail (now inside a decision card), the
before/after two-column (`.cmp.two`) + divergence marker, the code renderer
(`renderCode`), the decision card chrome (`chose`/contrast/`why`/qbox/ibox/nbox),
the theme toggle, all CSS custom properties.

Build: `renderStrip()` for the change-shape header; `renderPath(p)` that renders
the trace (before/after two-column for CHANGED) with, at each hop carrying
`decisions`, the decision(s) rendered inline-expanded (chip/chose/instead/why/
quote box) and the hop's code anchor shown by default. Notes render inline and
terse (no hover gate). Track a rendered-decision set so a decision cited twice
renders once, at its first hop.

## docs/design.md + generation-prompt.md + README.md

- design.md "Two tracks, one at a time" → "One decision-first walkthrough."
  Move behaviour-first framing to: the change-shape strip is the checkable
  at-a-glance; per-decision behaviour is the checkable detail. Update "Settled vs.
  open" (two-tracks is no longer settled; crossover is gone).
- generation-prompt.md: hops now hang off decisions; `note` is factual-only;
  reasoning belongs to `why`. Update the output schema block.
- README.md "Try it" / "How it works" walkthrough steps rewritten for one view.

## Verification

- `node validate.js prototype/data/sample-fix.json` → `valid`.
- Open `prototype/index.html`: strip reads at a glance; each decision shows its
  behaviour inline with code visible; d1 shows before/after + `:279`; d5 shows
  before-only; no dead toggle/crumb; theme toggle works; reduced-motion + narrow
  layout still hold.

## Non-goals

Not touching provenance semantics, not adding reviewer affordances (mark
understood/disputed), not changing delivery. Pure consolidation + honesty fix.
