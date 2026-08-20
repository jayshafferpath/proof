# Contracts

The data structures that cross proof's component boundaries are **versioned wire
contracts**. The emitter, the reducer, the validator, the renderer, and any future hosted
service each produce or consume one of these shapes; versioning lets them evolve without
silently misparsing each other.

## The `contract` field

Every payload self-identifies with a top-level `contract` tag:

```
proof.<name>/v<major>      e.g. "proof.spine/v1", "proof.ledger/v1"
```

For a single JSON object the tag is a top-level key. For a JSONL stream it is a **header
line** — a bare `{"contract": "proof.ledger/v1"}` — that precedes the event lines; a stream
may carry more than one header line over its life (a later emitter version appends a new one),
and the reducer negotiates against the ones it sees.

`generator/contract.js` is the single source of truth for parsing tags and for the majors each
tool speaks (`SUPPORTED`).

## Machine-readable schemas

The **structural** contract for each stable version is a JSON Schema (draft 2020-12) under
`schemas/` — the authority any generator or external consumer validates against:

| Contract | Schema | Enforced by |
|---|---|---|
| `proof.spine/v1` | `schemas/spine.v1.schema.json` | `validate.js` (structural gate, before semantic checks) |
| `proof.ledger/v1` | `schemas/ledger.v1.schema.json` (one event) | `reduce-ledger.js` (per event line) |

`generator/schema-check.js` is a dependency-free checker for the keyword subset these schemas
use (kept zero-dep on purpose — see the README). It owns **structure** only; the semantic rules
JSON Schema can't express (no two decisions share a hunk, coverage↔spine integrity,
`divergeAt` in range, monotonic `seq`) stay in `validate.js` / the reducer. The per-contract
docs (`spine-schema.md`, `ledger-schema.md`) are the annotated companions to these files.

## Versioning policy (semver for payloads)

- **Only the major is in the wire tag.** Minor/patch changes are additive and tracked in a
  contract's changelog, not the tag.
- **Additive change → same major.** A new optional field, or a new enum value older consumers
  can ignore. Producers may emit it; **consumers MUST ignore unknown fields**, never reject on
  them.
- **Breaking change → new major + new contract doc.** Removing or renaming a field, changing a
  type, tightening a required field, or changing the *meaning* of an existing field.
- **Consumers declare the majors they speak** and **fail closed** on anything else — an unknown
  or too-new contract is a *precondition* error (exit 2), never a best-effort parse and never a
  data-invalid result (exit 1).
- **Unversioned input** is assumed to be the earliest stable major of its shape, with a warning,
  for back-compatibility with pre-contract files.

## Index

| Contract | Status | Doc | Produced by | Consumed by |
|---|---|---|---|---|
| `proof.ledger/v1` | **stable** | `ledger-schema.md` | the `/decision-log` emitter (ticket-work) | `reduce-ledger.js` |
| `proof.spine/v1` | **stable** | `spine-schema.md` | the generation model; `--data` fixtures | `validate.js`, `ingest-diff.js`, `generate.js` |
| `proof.spine/v2` | **draft** | `spine-schema.md` § v2 | `reduce-ledger.js` | `validate.js` (v2 ruleset), `generate.js` (Decisions tab) |

`proof.spine/v2` now validates (`schemas/spine.v2.schema.json` + a lighter semantic ruleset —
no author/quote checks) and renders (a provenance-native Decisions tab: tier badges, revise
`history`, `reject` cards). It is **draft**, not yet **stable**: the Behaviour and Diff tabs are
absent because v2 evidence has no step narration and no attributed diff — the remaining two of
the three interface gaps (`.plans/build-time-decision-ledger.md`). When those land, v2 promotes
to stable.

## Who negotiates

- `validate.js` negotiates the input as `proof.spine` (defaults to v1 if untagged).
- `reduce-ledger.js` negotiates its input as `proof.ledger`, and stamps its output
  `proof.spine/v2`.
- `proof.sh` overwrites the `pr` object from resolved `gh` facts after generation; it does not
  touch `contract`.

## Changelogs

Each contract's own document carries its version history. This file governs *how* they version;
the per-contract docs record *what* changed at each major.
