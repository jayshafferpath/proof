#!/usr/bin/env bash
#
# retrofit.sh — render a walkthrough from a decision ledger and a PR's diff.
#
#   ledger (proof.ledger/v1) → reduce → ingest `gh pr diff` → enrich pr facts
#                            → validate (proof.spine/v2) → render self-contained HTML
#
# No model call: the ledger is the source of decisions (see /retrofit-ledger for
# how one is produced from a PR's artifacts). The diff is pulled from the PR, so
# it is pinned to the PR's own base — immune to local-worktree rebase drift.
#
# Usage:
#   retrofit.sh <ledger.jsonl> <pr-number> [--repo owner/name] [--out dir]
#
# Exit codes:
#   0  rendered to <out>/pr-<n>.html
#   1  validation failed
#   2  usage / precondition error
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

LEDGER=""
PR=""
REPO=""
OUT="$HERE/prototype"

while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    --out)  OUT="$2";  shift 2 ;;
    -h|--help) sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "❌ unknown flag: $1" >&2; exit 2 ;;
    *)  if [ -z "$LEDGER" ]; then LEDGER="$1"; elif [ -z "$PR" ]; then PR="$1"; fi; shift ;;
  esac
done

if [ -z "$LEDGER" ] || [ -z "$PR" ]; then
  echo "usage: retrofit.sh <ledger.jsonl> <pr-number> [--repo owner/name] [--out dir]" >&2
  exit 2
fi
[ -r "$LEDGER" ] || { echo "❌ ledger not readable: $LEDGER" >&2; exit 2; }
if [ -z "$REPO" ]; then
  REPO="${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT/data"
REDUCED="$OUT/data/pr-$PR.reduced.json"
DIFF="$TMP/pr-$PR.diff"
META="$TMP/pr-$PR.meta.json"

echo "· [1/5] gather — PR #$PR in $REPO"
gh pr view "$PR" --repo "$REPO" \
  --json number,title,baseRefName,baseRefOid,headRefName,headRefOid > "$META"
gh pr diff "$PR" --repo "$REPO" > "$DIFF"
HEAD_SHA="$(jq -r '.headRefOid' "$META")"
BASE_SHA="$(jq -r '.baseRefOid' "$META")"
TITLE="$(jq -r '.title' "$META")"
echo "    head=${HEAD_SHA:0:7} base=${BASE_SHA:0:7}"

echo "· [2/5] reduce — ledger → spine (proof.spine/v2)"
node "$HERE/generator/reduce-ledger.js" "$LEDGER" "$REDUCED"

echo "· [3/5] ingest — attribute the PR diff"
node "$HERE/generator/ingest-diff.js" "$REDUCED" "$DIFF" "$REDUCED"

# Prefer live gh facts for the pr coordinates — code citations pin to these SHAs,
# and the ledger does not carry repo/base/head (see docs/retrofit-ledger.md).
echo "· [4/5] enrich + validate"
jq --arg n "$PR" --arg t "$TITLE" --arg r "$REPO" --arg h "$HEAD_SHA" --arg b "$BASE_SHA" \
  '.pr = ((.pr // {}) + {number:$n, title:$t, repo:$r, headSha:$h, baseSha:$b})' \
  "$REDUCED" > "$REDUCED.tmp" && mv "$REDUCED.tmp" "$REDUCED"
if ! node "$HERE/validate.js" "$REDUCED"; then
  echo "❌ validation failed — not rendering." >&2
  exit 1
fi

echo "· [5/5] render — $OUT/pr-$PR.html"
node "$HERE/generate.js" "$REDUCED" "$OUT/pr-$PR.html"
echo "✓ walkthrough ready: $OUT/pr-$PR.html"
