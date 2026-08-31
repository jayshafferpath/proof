#!/usr/bin/env bash
#
# lib.sh — shared pipeline stages for the proof orchestrators.
#
# proof.sh, retrofit.sh, and proof.sh's stack loop all reconstruct the same
# middle band: resolve the repo, gather a PR's metadata + diff, overwrite the
# `pr` object with resolved gh facts, and run the ingest → validate → render
# tail. This file is the single home for those stages so a fix lands once
# instead of drifting across three copies.
#
# Contract for callers:
#   - Set HERE to the repo root (the dir holding generate.js / validate.js /
#     generator/) before sourcing. These functions resolve node scripts under it.
#   - These functions never print stage banners ("[1/5] gather", "· [layer 0]").
#     The caller owns progress output, because the numbering differs per script
#     (single-PR is 5 stages; the stack loop is per-layer). The functions may
#     still print their own errors to stderr.
#   - Functions take explicit arguments and touch no globals except HERE. SHA /
#     title extraction stays in the caller (a plain `jq -r` on the meta file),
#     so there is no hidden shared state.
#
# Sourced, not executed. Requires: gh, jq, node, and the same `set -euo
# pipefail` discipline as the callers.

# resolve_repo [override]
#   Echo the target repo (owner/name). Precedence: explicit override →
#   $GITHUB_REPOSITORY (set in CI) → the current gh checkout. Callers that also
#   accept a repo from a manifest should resolve that themselves and pass it as
#   the override, so this stays the single tail of the precedence chain.
resolve_repo() {
  local override="${1:-}"
  if [ -n "$override" ]; then
    printf '%s\n' "$override"
    return 0
  fi
  printf '%s\n' "${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"
}

# gather <pr> <repo> <meta_out> <diff_out>
#   Write the PR's metadata to <meta_out> and its unified diff to <diff_out>.
#   The diff is pulled from the PR itself (`gh pr diff`), so it is pinned to the
#   PR's own base and immune to local-worktree rebase drift.
#
#   `body` is always requested even though only the single-PR model path reads
#   it — one extra field is harmless and keeps this signature flag-free. The
#   caller extracts what it needs (SHAs, title) with its own `jq -r` on
#   <meta_out>; gather deliberately returns nothing but the two files.
gather() {
  local pr="$1" repo="$2" meta_out="$3" diff_out="$4"
  gh pr view "$pr" --repo "$repo" \
    --json number,title,body,headRefName,baseRefName,headRefOid,baseRefOid \
    > "$meta_out"
  gh pr diff "$pr" --repo "$repo" > "$diff_out"
}

# enrich_pr <data_json> <pr> <title> <repo> <head_sha> <base_sha>
#   Overwrite data.pr with resolved gh facts, in place. Citations pin to these
#   SHAs; a wrong SHA links to the wrong code, so the model/ledger is never
#   trusted to echo them. Merges onto any existing pr object rather than
#   replacing it, preserving fields the producer set.
enrich_pr() {
  local data_json="$1" pr="$2" title="$3" repo="$4" head_sha="$5" base_sha="$6"
  jq --arg n "$pr" --arg t "$title" --arg r "$repo" --arg h "$head_sha" --arg b "$base_sha" \
    '.pr = ((.pr // {}) + {number:$n, title:$t, repo:$r, headSha:$h, baseSha:$b})' \
    "$data_json" > "$data_json.tmp" && mv "$data_json.tmp" "$data_json"
}

# run_validate <data_json>
#   Validate the spine/stack payload. Returns non-zero (does not exit) on
#   failure so the caller can print its own context and choose the exit code —
#   the single-PR and stack callers word the failure differently.
run_validate() {
  node "$HERE/validate.js" "$1"
}

# run_tail <data_json> <diff_patch> <out_html>
#   The shared back half for the single-PR and retrofit paths: attribute the
#   real diff to decisions, validate, and render. On validation failure it
#   returns 1 without printing (the caller owns the message, because the
#   single-PR and retrofit callers word it differently and the single-PR text
#   is what CI posts as the PR comment). The `if !` guard at the call site keeps
#   `set -e` from firing, so the caller decides the exit code. The stack path
#   does NOT use this — it renders N+1 pages and calls run_validate directly on
#   the composed payload.
run_tail() {
  local data_json="$1" diff_patch="$2" out_html="$3"
  node "$HERE/generator/ingest-diff.js" "$data_json" "$diff_patch"
  run_validate "$data_json" || return 1
  node "$HERE/generate.js" "$data_json" "$out_html"
}
