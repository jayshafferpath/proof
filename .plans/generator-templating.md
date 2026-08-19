> **Status: DONE** (2026-08-19). Implemented against the current working-tree
> generator (diff-first tabs, compact drawer, restored sort). Verification baseline
> was the working-tree output, not HEAD. Both samples regenerate byte-identical except
> the intentional "do not edit" banner, which now names the .ejs / client.js sources.
> BUCKET_RANK single-sourced via a literal formatter (not JSON.stringify) to stay byte-exact.

# proof generator → EJS templating

## Context

Agents churn when editing `generate.js` because markup lives inside JS template
literals: 88 lines of client JS as a string, HTML tag soup with `${}` escaping
traps, and no separation between structure and logic. The earlier attempt at an
in-code restructure (extract client.js, dedupe helpers) was scrapped in favour of
moving markup out to **EJS templates** — a clearer home for structure that agents
can edit without fighting nested backticks.

Decisions locked with the user:
- **Vendor EJS** as a single committed file (`generator/vendor/ejs.js`). No
  `package.json`, no `npm install` — the "runs on bare node" promise stays true.
  `proof.sh`, `build.sh`, and CI are unchanged.
- **Convert markup-heavy templates only.** The recursive, logic-heavy fragment
  assembly (`renderDivergence`, `renderTrace`, `renderStep`) stays as JS helpers
  callable from templates. EJS where it clarifies; JS where it's genuinely better.
- **Escaping invariant (non-negotiable):** all author text continues to flow
  through `esc` / `richText` / `stepText`. In templates these are called as
  functions inside `<%- %>` (e.g. `<%- esc(d.title) %>`), never `<%= d.title %>`.
  `<%= %>` (EJS auto-escape) is avoided entirely so there is one escaping path,
  matching today's custom allowlist behaviour.

Output must remain **byte-identical** to the committed generator (verified by
regenerating both sample fixtures and diffing).

## Approach

### 1. Vendor EJS
- Obtain the single-file UMD build of `ejs` (zero runtime deps) and commit it at
  `generator/vendor/ejs.js`. Pin the version in a header comment.
- `require("./generator/vendor/ejs.js")` from `generate.js`.
- Templates rendered with `ejs.render(str, data, { rmWhitespace: false })` — must
  NOT strip whitespace (byte-identical requirement). Compile once per template,
  reuse across the render (client `cache` not needed for a one-shot CLI).

### 2. Template files under `generator/templates/`
Convert the flat, markup-dominant renderers. Each becomes a `.ejs` file loaded via
`fs.readFileSync` at startup (same pattern as `style.css`):

| Template | Replaces (generate.js) | Notes |
|---|---|---|
| `page.ejs` | `render()` shell (`:435`) | doctype, head, topbar, tabbar, body, `<%- clientJs %>` include, closing tags |
| `decision-card.ejs` | `renderDecision` (`:147`) | supports `compact` / `noId` flags via locals |
| `coverage.ejs` | `renderCoverage` (`:170`) | groups + rows |
| `behaviour-row.ejs` | `renderBehaviourRow` (`:357`) + `renderReasoningInline` | scenario/before/after/tests cells |
| `diff-file.ejs` | `renderDiffFile` (`:248`) | file head + hunks |

**Kept as JS helpers** (passed into templates as locals, called from `<%- %>`):
`esc`, `richText`, `stepText`, `ghUrl`, `ghFileUrl`, `renderStep`, `renderCode`,
`renderFragment`, `renderDivergence`, `renderTrace`, `renderAnchor`,
`renderProvenance`, `sourceChip` (new tiny shared helper for the author/infer
chip so card + reasoning strip don't duplicate it), `behaviourScenarios`,
`BUCKET_RANK`. These are logic, not markup.

### 3. Client JS out of the string
- Move the 88-line `<script>` body to `generator/client.js` (plain JS file).
- `page.ejs` inlines it: `<script>\n<%- clientJs %>\n</script>`.
- Single-source the sort order: `client.js` contains a `__BUCKET_RANK__`
  placeholder that `generate.js` fills via `.replaceAll("__BUCKET_RANK__",
  JSON.stringify(BUCKET_RANK))` before injecting. (Reason kept in a comment that
  does NOT contain the literal token, to avoid the substitution hitting the
  comment first.)

### 4. Wiring in generate.js
- At startup read: `style.css`, `client.js`, and each `.ejs` file (all via
  `path.join(__dirname, ...)`, same as today's css read).
- `render(data, assets)` where `assets = { css, client, templates }`. Keep
  `module.exports = { render, ... }` shape working; update `main()` to load assets
  and pass them.
- Templates receive a locals object bundling the kept JS helpers + data.

### Files touched
- **New:** `generator/vendor/ejs.js`, `generator/client.js`,
  `generator/templates/*.ejs` (5 files).
- **Modified:** `generate.js` (renderers → template loads + thinner helpers),
  `README.md` (Requirements: "no npm dependencies" → "one vendored file, no install
  step"; Layout section adds `generator/vendor/`, `templates/`, `client.js`),
  `CLAUDE.md` (source-of-truth section: markup now in `generator/templates/*.ejs`,
  client JS in `generator/client.js`, styles still in `style.css`; note the
  `<%- esc() %>`-only escaping invariant and byte-identical build check).
- **Unchanged:** `proof.sh`, `build.sh`, `.github/workflows/proof.yml`,
  `validate.js`, `generator/ingest-diff.js`, `.gitignore`, data JSON.

## Verification

1. `node --check generator/client.js` and `node -e "require('./generator/vendor/ejs.js')"`.
2. Capture fresh baselines from committed HEAD (independent of the tmp baselines):
   `git stash`, regenerate both samples to `/tmp`, `git stash pop`.
3. Regenerate with the new generator:
   - `node generate.js prototype/data/sample-fix.json OUT1`
   - `node generate.js prototype/data/pr-1227.json OUT2`
4. **`diff` each against its HEAD baseline — must be byte-identical.** Any diff is
   a bug to fix before finishing (whitespace, attribute order, escaping).
5. Extract the inlined `<script>` from generated HTML, `node --check` it, and
   confirm `var rank = {...}` is the substituted `BUCKET_RANK`.
6. `./build.sh` runs clean and writes `prototype/index.html` + `prototype/pr-1227.html`.
7. Spot-check both tabs render + theme toggle works by opening the HTML.

## Risks
- **Whitespace drift** is the most likely failure. EJS preserves template
  whitespace with `rmWhitespace: false`, but hand-transcribing markup into `.ejs`
  can shift indentation. The byte-diff gate catches it; expect an iteration or two.
- **Escaping regression** if any `<%= %>` or raw `<%- d.field %>` sneaks in.
  Grep the templates for `<%=` (should be zero) and for `<%-` uses that aren't a
  helper call, as a final check.
- Vendored file size: `ejs.js` is ~1500 lines committed. Acceptable given it
  removes the install step; noted in its header.
