#!/usr/bin/env bash
#
# install.sh — install a repo's Claude Code skills into your skills dir.
#
# Symlinks (default) or copies each skill directory under a source skills dir into
# ${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills, making them available in every
# session, not just from a checkout. Idempotent. Repo-agnostic.
#
# Usage:
#   install.sh [--from <dir>] [--dir <dir>] [--copy] [--force] [--uninstall]
#
#   --from <d>   source skills dir (default: <this script's repo>/.claude/skills)
#   --dir <d>    target skills dir (default: $CLAUDE_CONFIG_DIR/skills or ~/.claude/skills)
#   --copy       copy instead of symlink (self-contained; won't track edits)
#   --force      overwrite an existing entry (symlink or dir)
#   --uninstall  remove installed skills (only symlinks, unless --force)
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
    --from) SRC="$2"; shift 2 ;;
    --dir) DEST="$2"; shift 2 ;;
    --copy) MODE=copy; shift ;;
    --force) FORCE=1; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    -h|--help) sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "❌ unknown flag: $1" >&2; exit 2 ;;
  esac
done

[ -d "$SRC" ] || { echo "❌ no skills directory at $SRC" >&2; exit 2; }
SRC="$(cd "$SRC" && pwd)"
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

VERB="installed"; [ "$UNINSTALL" = 1 ] && VERB="uninstalled"
echo
echo "$count skill(s) $VERB · $DEST"
if [ "$UNINSTALL" != 1 ] && [ "$MODE" = symlink ] && [ "$count" -gt 0 ]; then
  echo "linked from $SRC — a skill that shells out to its repo's scripts needs that repo reachable (see the skill's docs)."
fi
