#!/usr/bin/env bash
#
# install-skills.sh — install this repo's skills into your Claude Code skills dir.
#
# Symlinks (default) or copies each skill under ./.claude/skills/ into
# ${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills, making them available in every
# session, not just from this checkout. Idempotent.
#
# Usage:
#   install-skills.sh [--copy] [--force] [--uninstall] [--dir <skills-dir>]
#
#   --copy       copy instead of symlink (self-contained; won't track edits)
#   --force      overwrite an existing entry (symlink or dir)
#   --uninstall  remove installed skills (only symlinks, unless --force)
#   --dir <d>    target skills dir (default: $CLAUDE_CONFIG_DIR/skills or ~/.claude/skills)
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE/.claude/skills"
DEST="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills"
MODE=symlink
FORCE=0
UNINSTALL=0

while [ $# -gt 0 ]; do
  case "$1" in
    --copy) MODE=copy; shift ;;
    --force) FORCE=1; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    --dir) DEST="$2"; shift 2 ;;
    -h|--help) sed -n '2,16p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "❌ unknown flag: $1" >&2; exit 2 ;;
  esac
done

[ -d "$SRC" ] || { echo "❌ no skills directory at $SRC" >&2; exit 2; }
mkdir -p "$DEST"

count=0
for path in "$SRC"/*/; do
  [ -d "$path" ] || continue
  path="${path%/}"
  name="$(basename "$path")"
  target="$DEST/$name"

  if [ "$UNINSTALL" = 1 ]; then
    if [ -L "$target" ]; then rm -f "$target"; echo "removed   $name"; count=$((count + 1))
    elif [ -e "$target" ] && [ "$FORCE" = 1 ]; then rm -rf "$target"; echo "removed   $name (dir)"; count=$((count + 1))
    elif [ -e "$target" ]; then echo "skip      $name (not a symlink; --force to remove)"
    fi
    continue
  fi

  if [ -L "$target" ] || [ -e "$target" ]; then
    if [ "$FORCE" = 1 ]; then rm -rf "$target"
    else echo "skip      $name (exists; --force to overwrite)"; continue; fi
  fi

  if [ "$MODE" = copy ]; then cp -R "$path" "$target"; echo "copied    $name"
  else ln -s "$path" "$target"; echo "linked    $name"; fi
  count=$((count + 1))
done

echo
echo "$count skill(s) → $DEST"

if [ "$UNINSTALL" != 1 ]; then
  echo
  echo "Skills that shell out to this repo's scripts resolve them via \$PROOF_HOME."
  echo "Add to your shell profile so they work from any directory:"
  echo "    export PROOF_HOME=\"$HERE\""
fi
