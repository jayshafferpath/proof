---
name: retrofit-stack
description: Reconstruct a stacked-PR walkthrough from any PR in the stack. Use when asked to build a stack view, retrofit a stack, or produce a proof stack walkthrough starting from a single PR number (rather than a hand-written manifest). Resolves the whole chain from GitHub ref topology, retrofits a decision ledger per layer, writes the manifest, and renders. Takes any PR number in the stack (and repo).
---

# Retrofit a stacked-PR walkthrough

Turn any one PR in a stack into a single stack walkthrough — the standalone
`stack-<top>.html` plus a per-layer `pr-<n>.html` with an embedded Stack tab —
by resolving the whole chain, retrofitting a ledger for each layer, and
rendering. This is the stack-scoped sibling of `/proof:retrofit-ledger`: it
drives that same per-PR reconstruction once per layer, then composes.

Provenance inherits the retrofit ceiling: every event is `by: retrofit`, capped
at `through-review`, never `first-hand` (see `docs/retrofit-ledger.md`). Do not
fabricate reasoning; assert only what a PR's artifacts support.

**Location.** This is a plugin skill. The commands below invoke bundled scripts
via `${CLAUDE_PLUGIN_ROOT}` — Claude Code substitutes the plugin's install path,
so scripts resolve wherever the plugin lives, with no `PROOF_HOME`. All
**outputs** (ledgers, manifest, HTML) go to `./proof-out/` in the current
working directory (the repo you are retrofitting), never inside the plugin.

## Inputs

- `<pr-number>` — **any** PR in the stack (floor, top, or middle) and
  `--repo owner/name` (default: the current checkout).

## Procedure

### 1. Resolve the chain (mechanical — do not reason about it)

Fetch the open-PR ref graph and let the resolver walk it. It walks *down*
(following base branches to the floor) and *up* (to the PR nobody builds on),
so the entry PR can be any layer:

```
mkdir -p proof-out
gh pr list --repo <repo> --state open --limit 200 \
  --json number,title,baseRefName,headRefName > proof-out/prs.json

node "${CLAUDE_PLUGIN_ROOT}/generator/resolve-stack.js" <pr-number> <repo> \
  proof-out/prs.json > proof-out/stack.manifest.json
```

The manifest skeleton lists the layers bottom → top. Read it: confirm the layer
set and order match what the PRs' own descriptions say (a stacked PR usually
states "Stacked on #N" — use that to sanity-check, not to override the
topology). If a layer that should be in the stack is **merged/closed**, it will
be absent (the resolver only sees open PRs and stops at a base that is no longer
an open head); that is correct — a merged lower layer is already on the base
branch and is not part of the reviewable stack.

### 2. Retrofit a ledger per layer (interpretive — the real work)

For **each** layer PR in the manifest, produce `proof-out/pr-<n>.ledger.jsonl`
by following the `/proof:retrofit-ledger` procedure in full: read that PR's
`gh pr view <n> --json title,body,commits` and its diff, identify 4–8 decisions
(plus any rejects), and emit each through the ledger CLI with the PR's own head
SHA:

```
node "${CLAUDE_PLUGIN_ROOT}/generator/ledger-cli.js" append \
  --ledger "proof-out/pr-<n>.ledger.jsonl" \
  --commit <THIS_LAYER_PR_HEAD_SHA> \
  --event '{"event":"realize","id":"d1","by":"retrofit","ticket":"<branch-or-ticket>",
            "phase":"execute","title":"...","chose":"...","rejected":"...","why":"...",
            "ac":[],"anchors":[{"file":"path","lines":"~","role":"anchor"}]}'
```

**The one stack-specific rule — anchor the builds-on seams.** A later layer's
decision that depends on something a lower layer introduced must carry an
evidence anchor to that lower layer's file, marked `context: true` (it is not in
the later layer's own diff). That `context` anchor is exactly what
`compose-stack.js` reads to draw the builds-on edge between layers; without it,
the layers render as unrelated. Example: the endpoint PR that consumes a package
the extraction PR created anchors the package's public files with `context: true`.
Everything else follows `/proof:retrofit-ledger` unchanged (`by: retrofit`,
line-pinned anchors, `reject` needs a reason, `verify`/`close` reference a decision).

### 3. Fill the manifest

Edit `proof-out/stack.manifest.json`: fill the `epic` (title/goal/note — the
stack's shared purpose, from the PRs' descriptions or a linked plan) and each
layer's `summary` and `capability`. Leave `ledger` paths as the resolver wrote
them; confirm each points at the file you produced in step 2. If a `planFile`
with EARS acceptance criteria exists, add `"planFile": "<relative-path>"` and
per-layer `"acids": ["CX-3", ...]` so the AC text resolves into the layer cards.

### 4. Render (deterministic — no model, no creds beyond gh)

```
"${CLAUDE_PLUGIN_ROOT}/proof.sh" stack proof-out/stack.manifest.json \
  --repo <repo> --out proof-out
```

This reduces each ledger, ingests each layer's base-pinned `gh pr diff`,
enriches `pr` facts, composes `proof.stack/v1` (deriving seams + builds-on
edges), validates, and renders `proof-out/stack-<top>.html` plus one
`proof-out/pr-<n>.html` per layer with the Stack tab embedded.

## Output

Report the rendered paths and a one-line summary per the compose step: N layers,
the builds-on edge count, and the seam-file count. If builds-on edges is 0 for a
stack whose PRs clearly depend on each other, you missed the `context`-anchor
rule in step 2 — go back and anchor the consuming decisions to the lower layer's
files. The unexplained-file warnings from validate are the honest coverage
remainder — do not hide them.
