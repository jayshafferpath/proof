# Walkthrough spine — contract

The walkthrough payload: `{ contract, pr, decisions[], coverage?, diff? }`. Rendered by
`generate.js`, checked by `validate.js`, its diff computed by `ingest-diff.js`. Governance and
the versioning policy live in `contracts.md`; design rationale in `.plans/decision-spine.md`.

---

## `proof.spine/v1` — stable

The reconstruction-era shape: a decision's provenance is the binary `source: "author" | "infer"`
backed by a verbatim quote or an inference note. This is what the generation model emits and
what `validate.js` enforces today.

**Machine-readable:** `schemas/spine.v1.schema.json` is the structural authority; the JSONC below
is its annotated companion. `validate.js` runs the schema first (a shape violation is exit 1),
then the semantic rules the schema can't express.

```jsonc
{
  "contract": "proof.spine/v1",
  "pr": { "number", "title", "repo", "headSha"?, "baseSha"? },
  "decisions": [
    {
      "id": "d1",
      "title": "the choice, imperative",
      "source": "author | infer",
      "chose": "…", "rejected": "…", "why": "…",
      // exactly one provenance block, by source:
      "quote": "near-verbatim author text", "quoteSrc": "origin",   // iff author
      "inferNote": "inferred vs stated", "inferSrc": "code path",   // iff infer
      "note": "optional caveat",
      "evidence": [
        { "kind": "divergence | trace | anchor",
          "before"?, "after"?, "divergeAt"?, "divergeNote"?,   // divergence
          "trace"?, "regression"?,                              // trace
          "claim"?,                                             // anchor
          "tests"?: [ { "file", "name" } ],
          "code": { "file", "lines", "hl": [a,b], "context": bool, "rows": [[n,text,add]] } }
      ]
    }
  ],
  "coverage"?: { "explained": [{file, byDecisions}], "mechanical": [{file, why}],
                 "tests": [{file, covers}], "unexplained": [{file, why}] },
  "diff"?: [ /* tool-derived by ingest-diff.js — never authored */ ]
}
```

Rules enforced by `validate.js` (unchanged from the pre-contract validator): `author` ⇒
quote+quoteSrc; `infer` ⇒ inferNote+inferSrc; every fragment has a valid `kind` and a code
anchor; `divergeAt` in range; **no two decisions rest on the same hunk+hl**; coverage↔spine
integrity; diff attributions agree with the spine.

**v1 changelog** — `v1.0`: initial contract (extracted from the shipped shape; adds only the
`contract` tag, which older readers ignore).

---

## `proof.spine/v2` — proposed (unstable)

The ledger-native shape emitted by `reduce-ledger.js`. It **replaces** v1's provenance model
(there is no verbatim `quote` — first-hand reasoning is not quoted from anywhere) and **adds**
the decision history and rejects that reconstruction cannot produce.

**Machine-readable:** `schemas/spine.v2.schema.json`. `validate.js` runs it under a lighter
semantic ruleset (no author/quote checks; coverage↔id integrity still enforced), and
`generate.js` renders a provenance-native Decisions tab (tier badges, `history` disclosure,
`reject` cards). Gap #1 (provenance rendering) is **done**; v2 stays **draft** until gaps #2/#3
land.

Differences from v1, per decision:

```jsonc
{
  // REMOVED: source, quote, quoteSrc, inferNote, inferSrc
  "provenance": "reconstructed | first-hand | through-review | machine-verified | author-confirmed | author-verified",
  "provenanceTrail": [ { "seq", "event", "by", "phase", "reason"? } ],
  "history": [ { "seq", "chose", "why", "reason" } ],   // superseded states from `revise`
  "isReject": bool,                                      // a deliberate non-change (r*)
  "ac": [ "AC-2" ],
  "evidence": [ { "kind", "code": { … } } ]              // step narration: gap #2 (TBD)
}
```

Open before v2 can stabilize (all tracked in `.plans/build-time-decision-ledger.md`):

1. **Provenance rendering** — `generate.js` must show the tier + trail + `history` disclosure
   instead of the author/infer chip, and `validate.js` needs a v2 ruleset.
2. **Step narration** — v2 evidence currently has `kind` + `code` but no `step`/`note`
   sequences; either the ledger captures them or they are derived from the anchored code.
3. **Coverage** — the reducer fills `explained` + `tests` from the ledger; `mechanical` and the
   full test set still require `ingest-diff.js` reconciliation.

When these land, v2 moves to **stable** and enters `SUPPORTED`.
