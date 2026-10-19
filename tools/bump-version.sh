#!/usr/bin/env bash
# Give every cache-busting ?v= key in the dashboard a new value (a timestamp), so
# browsers fetch the new files after a deploy. Run before committing front-end changes.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
V="$(date +%y%m%d%H%M)"
sed -i '' -E "s/\?v=[0-9]+/?v=$V/g" "$ROOT/index.html" "$ROOT/services/index.html"
sed -i '' -E "s#services/index.html\?v=[0-9]+#services/index.html?v=$V#" "$ROOT/js/"*.js
echo "Cache keys set to v=$V"
