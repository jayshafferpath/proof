#!/usr/bin/env bash
# Regenerate the sample walkthroughs from their data. The HTML is a build
# artifact (gitignored) — this is how you produce it locally after a clone or
# after changing generate.js / generator/style.css.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

node "$HERE/generate.js" "$HERE/prototype/data/sample-fix.json" "$HERE/prototype/index.html"
node "$HERE/generate.js" "$HERE/prototype/data/pr-1227.json" "$HERE/prototype/pr-1227.html"
