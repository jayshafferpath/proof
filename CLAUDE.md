# CLAUDE.md

`proof` generates a self-contained HTML walkthrough of a pull request — the author's
**decisions** and the **runtime behaviour** they produce, each claim anchored to a real
line and tagged author-stated or AI-inferred. It explains a change; it does not review it.

Read `README.md` for the full model and `docs/design.md` for settled-vs-open questions.
This file is the operational map — where things live and how to not break them.

## Critical: the HTML is a build artifact — gitignored, never edit by hand

`prototype/*.html` are **generated and gitignored**. Never edit them by hand — the next
render silently destroys the change (this is how the diff sort control was lost once). The
output carries a "do not edit" banner comment. Source of truth:

- **Markup / structure** → `generator/templates/*.ejs` (`page.ejs` shell + `decision-card`,
  `coverage`, `behaviour-row`, `diff-file`). Rendered by EJS (`generator/vendor/ejs.js`,
  vendored — no npm install).
- **Client behaviour** → `generator/client.js` (tabs, reasoning drawer, diff sort). Inlined
  into a `<script>` at generate time; `__BUCKET_RANK__` is substituted so the sort order is
  single-sourced with the server.
- **Styles** → `generator/style.css` (inlined at generate time, not linked).
- **Assembly / logic** → `generate.js`. The `render*Tab` functions and helpers
  (`renderStep`, `renderDivergence`, etc.) compute conditional pieces and feed the templates;
  `loadAssets()` reads templates + client.js + css at startup.
- **Content / data** → `prototype/data/*.json`.

**Escaping invariant:** author text flows through `esc`/`richText`/`stepText` only. In
templates these are called inside `<%- %>` (never `<%= %>` — grep should find zero `<%=`),
so there is one escaping path.

Regenerate the samples after any generator, template, or data change:

```sh
./build.sh          # both samples
# or one: node generate.js prototype/data/pr-1227.json prototype/pr-1227.html
```

There is no test suite. The safety net is a **byte-identical** check: changing structure
without intending an output change should regenerate to the same bytes. Verify by
regenerating and diffing (or `git diff` if committed), then opening the HTML.

## The rendered page

Three tabs, built by `generate.js`:

- **Behaviour** (`renderBehaviourTab`) — matrix of runtime scenarios, CHANGED/NEW/UNCHANGED.
- **Decisions** (`renderDecisionsTab`) — master/detail: left `.md-list` sidebar of decisions
  + coverage map; right `.md-detail` pane.
- **Diff** (`renderDiffTab`) — unified diff on the left, right `.diff-why` reasoning drawer
  that reveals the decision behind a clicked line.

Behaviour and Diff are **derived** from the decisions + evidence — never authored separately,
so they can't desync from the spine. Default tab logic lives at `generate.js:~427`: opens on
Behaviour when scenarios exist, else Decisions. This ordering is a documented design decision
(the first screen should be checkable against code) — changing it overrides `docs/design.md`.

## Pipeline

`proof.sh` runs gather → generate (only model step, Claude on Bedrock) → ingest → validate →
render. Use `--data file.json` to inject pre-generated JSON and skip the model call (no
Bedrock creds needed) — the mechanical path for tuning and testing. Individual stages:

```sh
node generator/ingest-diff.js <data.json> <raw.diff> [out.json]
node validate.js <data.json>
node generate.js <data.json> [out.html]
```

`validate.js` enforces provenance mechanically (exits non-zero): author-stated needs a quote,
inferred needs a note, evidence anchors must resolve, no two decisions share a hunk, coverage
buckets must account for every non-context file.

CI: `.github/workflows/proof.yml` on `pull_request`, Bedrock via OIDC, upserts a PR comment.
