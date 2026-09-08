# Plan: bring the product back onto its principles

Written 2026-09-05 from an honest-take review. Audience: an implementing agent that should
follow steps literally and stop at the marked decision points rather than improvise.

## Why

The thesis (`docs/design.md`) is: every claim is anchored to a real line and tagged with its
provenance, so a reviewer can *check* rather than *trust*. Three drifts have moved the shipped
product away from that:

1. **Docs and code disagree about the first screen.** `README.md:77`, `CLAUDE.md:47`, and
   `docs/design.md:30` say the page opens on Behaviour. `generate.js:785` says "Diff-first" and
   opens on Diff. The v2/stack pages have no Behaviour tab at all.
2. **The retrofit path (v2) dropped the checkable layer.** `skills/retrofit-ledger/SKILL.md`
   tells the model to emit file-level `"~"` anchors. Result on the committed sample
   `prototype/pr-277.html`: no code shown, no lines, 11 of 13 diff files UNEXPLAINED, tests
   bucket empty. Compare `prototype/data/pr-1227.json` (v1): line-pinned, 0 unexplained.
3. **The load-bearing human step has no mechanism.** "Author is the first verifier" is in the
   design; nothing in the product lets an author confirm or correct. And `validate.js:183`
   checks that a quote *exists*, not that it is verbatim.

This plan fixes those three, in order, with small bounded tasks. It does **not** build the
live ledger emitter, the hosted renderer, or reviewer affordances.

## Global rules (apply to every task)

- **Never edit `prototype/*.html` by hand.** They are generated. Regenerate with `./build.sh`.
- **Byte-identical check.** Before Task 1, build a baseline (Task 0). After every task that
  touches `generate.js`, `generator/`, or `prototype/data/`, rebuild and `diff` against the
  baseline. Any difference must be one the task intended; describe it in the commit message.
- **Escaping invariant.** Author text goes through `esc`/`richText`/`stepText` only. Templates
  use `<%- %>` only. `grep -rn '<%=' generator/templates` must return nothing.
- **Validation must stay green** on every committed sample after every task:
  ```sh
  for f in prototype/data/sample-fix.json prototype/data/pr-1227.json \
           prototype/data/pr-299.reduced.json prototype/data/nev-1539.reduced.json \
           prototype/data/stack-sample.json; do node validate.js "$f" || echo "FAIL $f"; done
  ```
- **One branch per task**, PR against `main`, small commits. Do not combine tasks.
- **Stop and ask** at every line marked `DECISION`. Do not guess.

---

## Task 0 — working environment and baseline

Node on this machine is Homebrew `node@10.4.0` and aborts on load (missing
`libicui18n.61.dylib`). Nothing builds until this is fixed. `package.json` requires `>=18`.

Steps:
1. Install a current Node. Preferred: `brew install node` (Node 22+). If Homebrew is not
   allowed, `asdf plugin add nodejs && asdf install nodejs latest && asdf global nodejs latest`
   (asdf is already installed at `~/.asdf`).
2. Verify: `node --version` prints 18 or higher and `./build.sh` exits 0.
3. Save a baseline of every generated page:
   ```sh
   mkdir -p /private/tmp/proof-baseline && ./build.sh && cp prototype/*.html /private/tmp/proof-baseline/
   ```
4. Run the validation loop from Global rules. All five must pass. If any fails before you have
   changed anything, stop and report it; do not fix it inside Task 0.

Done when: `./build.sh` succeeds, baseline saved, validation green.

---

## Task 1 — make the docs describe the shipped product

No code changes in this task except one comment.

### 1a. `DECISION` — which first screen is correct?

The code opens on **Diff** (`generate.js:785-788`, fallback Behaviour, then Decisions). Three
docs say **Behaviour**. Ask the user: "Keep Diff-first as shipped, or restore Behaviour-first?"

If no answer is available, assume **Diff-first is correct** (it was a later deliberate change,
see `.plans/generator-templating.md` "diff-first tabs") and change the docs, not the code.

### 1b. Update the three docs to match

- `README.md` "The rendered walkthrough" section (lines ~75-92): state the actual default-tab
  rule: opens on Diff when a diff is present; else Behaviour when scenarios exist; else
  Decisions. Keep the three tab descriptions.
- `CLAUDE.md` "The rendered page" section: same rule. Replace the sentence that says default
  logic "opens on Behaviour when scenarios exist, else Decisions" and the sentence that says
  changing it overrides `docs/design.md`.
- `docs/design.md`:
  - Replace the "Two tracks, one at a time" section and "Crossover is the connective tissue"
    section with a section titled **"One spine: decisions"** that says, in this order:
    the spine is the ordered list of decisions; behaviour and diff are *derived* evidence a
    decision owns, never authored separately; the three views are Diff (what → why lookup),
    Behaviour (runtime scenarios derived from evidence steps), Decisions (why → what reading
    order). Source for this text: `.plans/decision-spine.md` "The two calls that fix the shape"
    and `.plans/diff-tab.md` "Why this is not the dead end". Do not invent new rationale.
  - Under "Settled vs. open", replace "two tracks, one at a time; behaviour-first" with
    "one decision spine; diff-first landing; behaviour and diff derived".
  - Add a short **"History"** subsection at the bottom: "The first design (Aug 2026) had two
    peer tracks with a crossover. It was superseded by the decision spine; see
    `.plans/merge-tracks.md` and `.plans/decision-spine.md`."
  - Keep the "Provenance is the load-bearing rule" and "The author is the first verifier"
    sections unchanged.

### 1c. Fix stale references

- `docs/generation-prompt.md` line 3: "consumed by `prototype/index.html`" → "consumed by
  `generate.js`". Section "The diff view": "has two tabs" → "has three tabs (Diff, Behaviour,
  Decisions)".
- `docs/contracts.md` Index table, row `proof.ledger/v1`, column "Produced by": change to
  "`generator/ledger-cli.js` (today: the `/proof:retrofit-ledger` skill; a live
  `/decision-log` emitter is planned, not built)".
- `generate.js:785` comment: leave as is if 1a chose Diff-first.

Verify: `./build.sh` and diff against baseline. **Zero differences** expected (docs only).

Done when: no doc claims Behaviour-first unless 1a chose it; `grep -rn "index.html" docs/`
returns nothing; commit titled "Reconcile design docs with the shipped decision-spine, diff-first page".

---

## Task 2 — verbatim quote check in the validator

Today an `author` decision passes with any non-empty `quote`. Add an optional check that the
quote actually appears in the PR inputs.

### 2a. `validate.js`

- Accept a second optional argument: `node validate.js <data.json> [--inputs <file>]`. Keep
  the existing usage working unchanged when the flag is absent.
- When `--inputs` is given, read the file as text and build a normalized haystack:
  lowercase; collapse all whitespace runs to one space; strip the characters `` ` * _ ``
  (markdown emphasis and code ticks). Write one function `normalize(s)` and use it for both
  sides.
- For every v1 decision with `source === "author"` and a `quote`:
  - Split the quote on `...` and on `…` (some quotes join two excerpts with an ellipsis, e.g.
    `pr-1227.json` d1). Drop empty pieces and pieces shorter than 12 characters after
    normalization.
  - Each remaining piece must be a substring of the normalized haystack. If any piece is not,
    push an **error**: `${d.id}: quote not found verbatim in PR inputs: "<first 60 chars>"`.
- When `--inputs` is absent, push one **warning** once (not per decision): `quotes not checked
  against PR inputs (pass --inputs)`.
- Do not touch the v2 or stack branches. They have no quotes.

### 2b. `proof.sh`

In the single-PR path, the gather stage already has title and body in `$META_JSON` and the
commit log in `$COMMITS` (only inside the `else` branch, around line 255). Move the `COMMITS=`
line up so it runs in both the `--data` and the model path, then write one inputs file after
gather:
```sh
INPUTS="$TMP/pr-$PR.inputs.txt"
{ jq -r '.title, .body // ""' "$META_JSON"; echo; echo "$COMMITS"; } > "$INPUTS"
```
Change the validate call (around line 342) to `node "$HERE/validate.js" "$DATA_JSON" --inputs "$INPUTS"`.

Do not add review-thread comments to the inputs in this task.

### 2c. Verify

- `node validate.js prototype/data/pr-1227.json` still passes, now with the new warning.
- Write a fixture `prototype/data/quote-check.inputs.txt` containing the pr-1227 PR body text
  that the sample's quotes were taken from. `DECISION`: the body is not in this repo. Ask the
  user to paste it, or run `gh pr view 1227 --repo pathccm/marketing --json title,body` if
  access exists. If neither is possible, skip 2c-fixture and test with a temporary file that
  contains the quotes copied from the JSON itself (proves the mechanism, not the data).
- Negative test: alter one word of a quote in a scratch copy of the JSON and confirm validate
  exits 1 with the new error.
- `./build.sh` diff against baseline: zero differences.

Done when: the negative test fails validation, the samples pass, README "Provenance and
validation" gains one sentence: "With `--inputs`, author quotes are also checked verbatim
against the PR title, body, and commit messages; `proof.sh` passes this automatically."

---

## Task 3 — give the retrofit path line-pinned, visible evidence

Goal: a v2 page shows the same kind of checkable evidence a v1 page does. Three parts, each
mechanical except 3a which changes an instruction.

### 3a. `skills/retrofit-ledger/SKILL.md` — pin lines

Replace the "Anchors are coarse" rule with:

> **Anchors are line-pinned.** For every anchor, read the PR diff (`gh pr diff <n>`) and set
> `lines` to the range in the **new** file (the `+++` side) of the hunk that realizes this
> decision, e.g. `"276-281"`. Set `hl` to the 1-6 lines inside that range that matter most.
> Use `"~"` **only** when the decision is a pure scoping call with no code, and say so in
> `why`. A `context: true` anchor (out-of-diff code) may keep `"~"`.
> Also attach `tests`: `[{ "file": "...", "name": "<test name>" }]` on the `realize` event for
> every test file the diff adds or changes that exercises the decision.

Add to the Output section: "Report how many anchors are line-pinned vs `~`. More than one `~`
on a non-context anchor is a smell."

Make the same replacement in `skills/retrofit-stack/SKILL.md` where it says "coarse anchors".

Update `docs/retrofit-ledger.md` "hard ceiling" bullet **Precise evidence**: it currently
claims line attribution is structurally impossible. Rewrite to: "Line pins come from reading
the diff, same as the reconstruction path. What retrofit cannot recover is *which* of several
plausible hunks the author had in mind when the artifacts are silent; in that case anchor the
hunk the `why` text most directly describes and keep the provenance tier honest."

### 3b. `generator/ingest-diff.js` — fill `code.rows` from the diff for v2

`ingest-diff.js` already parses every hunk and knows each evidence range
(`buildAnchors`, `attributeLine`). Extend it so that, **only when `data.contract ===
"proof.spine/v2"`**, every non-context evidence fragment whose `code.rows` is absent gets
`rows` filled from the diff:

- For the fragment's file and parsed range `[lo, hi]`, collect diff lines whose `new` number is
  within `[lo, hi]` and `sign` is `+` or ` `, in order.
- Emit `rows` as `[[String(new), text, sign === "+" ? 1 : 0], ...]`, the same shape v1 uses
  (`docs/generation-prompt.md` "Code": `[lineNumber, text, isAddedLine]`).
- If the range is not found in the diff (no lines collected), leave `rows` absent and print a
  warning: `warn  <decision>: <file>:<lines> not in diff — no code to show`.
- Never overwrite an existing non-empty `rows`. Never touch v1 data (guard on contract).

Add `rows` to `schemas/spine.v2.schema.json` under `evidence.code.properties`:
```json
"rows": { "type": "array", "items": { "type": "array", "minItems": 3, "maxItems": 3 } }
```

### 3c. `generate.js` — render rows on v2

In `renderEvidenceV2` (`generate.js:443`): if `ev.code.rows` is a non-empty array, return
`renderCode(ev.code)` with the role badge prepended inside the `.ev-file` header; otherwise keep
the current output byte-for-byte. Simplest: keep the existing function for the no-rows case and
add an early branch for the rows case that builds the same header string plus
`<pre class="code">…</pre>` using the row loop from `renderCode`. Do not change `renderCode`
itself (v1 must stay byte-identical).

Check `generator/style.css` has `.role-badge` and `pre.code` styles already (it does). No CSS
changes needed.

### 3d. Regenerate the committed v2 sample

`prototype/pr-277.html` and `prototype/data/nev-1539.ledger.jsonl` are committed. After 3a-3c:

- `DECISION`: re-running `/proof:retrofit-ledger 277 --repo pathccm/attribution-service`
  requires access to that private repo and a model. Ask the user to run it, or to grant access.
- If the user cannot, do the mechanical half only: hand-edit
  `prototype/data/nev-1539.ledger.jsonl` **is not allowed** (append-only ledger). Instead,
  leave the sample as is and note in the PR that the sample predates line pins.

Verify:
- `./build.sh` diff against baseline: v1 pages (`index.html`, `pr-1227.html`) **identical**.
  `stack-sample.html` may differ only if its layer spines gained `rows` (they are committed
  reduced spines with `~` anchors, so expect identical).
- Run `retrofit.sh` on any PR you do have access to (e.g. a PR in this repo, `--repo
  jayshafferpath/proof`) with a ledger written per the new skill rule, open the HTML, and
  confirm evidence cards show code with line numbers and highlighted rows, and the Diff tab
  attributes those lines (click one; the reasoning drawer should open).

Done when: a fresh retrofit shows code in evidence cards and attributed lines in the Diff tab.

---

## Task 4 — the smallest author-correction loop

The design says generate → **author corrects** → publish. Build the correction step as two
tiny CLIs and document them. No UI.

### 4a. v1: `generator/confirm.js`

```
node generator/confirm.js <data.json> <decision-id> --quote "<verbatim text>" --src "<where it is>"
```
- Loads the JSON, finds the decision, requires `source === "infer"` (error otherwise).
- Sets `source: "author"`, `quote`, `quoteSrc`; deletes `inferNote` and `inferSrc`; appends
  to `note` (creating it if absent): `Confirmed by author <YYYY-MM-DD>.`
- Writes the file back with `JSON.stringify(data, null, 2) + "\n"` (same formatting
  `ingest-diff.js` uses).
- Prints a reminder: `re-run: node validate.js <file> --inputs <inputs> && node generate.js <file>`.
- The quote must still pass Task 2's verbatim check, which is the point: an author "confirms"
  by pointing at their own words, not by asserting.

### 4b. v2: document the existing path

For a ledger-derived page, confirmation already exists mechanically: a `by: human` `verify`
event raises the tier to `author-verified` (`docs/ledger-schema.md` provenance table). Nobody
has written down how to do it. Add to `README.md` under "Retrofit" a subsection **"Author
verification"**:
```sh
node generator/ledger-cli.js append --ledger <ledger.jsonl> --commit <head-sha> \
  --event '{"event":"verify","id":"D3","by":"human","ticket":"<TICKET>","phase":"review",
            "reason":"I wrote this; the fail-closed gate is exactly as described"}'
./retrofit.sh <ledger.jsonl> <pr> --repo owner/name
```
Then verify by running it against a scratch copy of `prototype/data/nev-1539.ledger.jsonl`
(copy first; do not modify the committed fixture) and confirming the reduced spine shows
`author-verified` for that decision and the badge renders.

### 4c. Docs

- `README.md` "Status → Verification" bullet: replace "Treat CI-generated output as a draft
  until the author has reviewed it" with a pointer to `generator/confirm.js` (v1) and the
  `verify` event (v2), and keep the sentence that CI output is a draft.
- `CLAUDE.md` "Pipeline" section: add `confirm.js` to the individual-stages list.

Verify: `./build.sh` diff against baseline: identical. Validation loop green.

Done when: both paths are runnable from the README with no other knowledge.

---

## Task 5 — v2 page polish seen in the screenshot (optional, small)

From `prototype/pr-277.html` at 1457px wide:

- Sidebar decision titles wrap to 6 lines; tier badges clip ("RECON…"). In
  `generator/style.css`: widen `.md-list` (currently narrow) to about 300px and let the badge
  sit on its own line under the title (`flex-wrap: wrap` on the item, badge `flex-basis: 100%`).
- Diff tab lands on a wall of collapsed `UNEXPLAINED` rows. In the v2 diff render, sort
  files so `explained` comes first (the sort control from `generator/client.js`, ordered by
  `__BUCKET_RANK__`, already exists for v1; confirm the v2 tab uses the same default ordering).

Verify: v1 pages byte-identical unless the CSS change is shared, in which case screenshot
both before and after and confirm nothing regressed. This task is cosmetic; skip it if it
threatens the byte-identical invariant on v1.

---

## Not in this plan (user decides later)

- **Collapse the provenance ladder** to the three tiers producible today (`reconstructed`,
  `through-review`, `author-verified`). Touches schema, reducer, docs, and badges. Needs a
  design call first.
- **Second reviewer.** Put a real PR walkthrough in front of someone other than the author and
  record what they did with it. This is the most valuable step in the whole list and only the
  user can do it.
- **Coverage `mechanical` bucket for v2.** The reducer only fills `explained` and `tests`.
  Everything else is honestly `unexplained`. Either the skill classifies wiring files or the
  ingest step needs a heuristic; both are judgment calls.
- Hosted renderer, reviewer affordances, weight, audience split: unchanged from `design.md`.

## Order and size

| Task | Size | Depends on |
|---|---|---|
| 0 environment + baseline | small | — |
| 1 docs reconcile | small, one DECISION | 0 |
| 2 verbatim quote check | small | 0 |
| 3 line-pinned retrofit evidence | medium, one DECISION | 0, 2 (for the confirm flow later) |
| 4 author-correction loop | small | 2, 3b |
| 5 polish | small, optional | 3c |
