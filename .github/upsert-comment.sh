#!/usr/bin/env bash
#
# Post or update a single PR comment identified by a hidden HTML marker.
# Re-running proof on a new push updates the one comment rather than piling up.
# Mirrors the org post-pr-comment action, inlined here to keep proof self-contained.
#
# Usage: upsert-comment.sh <owner/repo> <pr-number> <marker> <body-file>
set -euo pipefail

REPO="$1"
PR="$2"
MARKER="$3"
BODY_FILE="$4"

[ -r "$BODY_FILE" ] || { echo "❌ body file not readable: $BODY_FILE" >&2; exit 1; }

# The marker is the first line of every comment this script writes, so an exact
# substring match finds a prior one. --jq contains() is literal, no escaping.
EXISTING=$(gh api "repos/$REPO/issues/$PR/comments" --paginate \
  --jq ".[] | select(.body | contains(\"$MARKER\")) | .id" | head -1)

if [ -n "$EXISTING" ]; then
  gh api "repos/$REPO/issues/comments/$EXISTING" -X PATCH -F body=@"$BODY_FILE" >/dev/null
  echo "✅ updated comment $EXISTING"
else
  gh pr comment "$PR" --repo "$REPO" --body-file "$BODY_FILE" >/dev/null
  echo "✅ posted new comment"
fi
