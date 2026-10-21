#!/usr/bin/env bash
# Push every CS Dashboard Apps Script project, with the shared sign-in check
# (apps-script/shared/dash-auth.js) copied in, and redeploy each web app in place.
#   tools/push-scripts.sh            # push + redeploy all
#   tools/push-scripts.sh loop       # just one (scorecards|firm|loop|contracts|mrr|bound|master)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AS="$ROOT/apps-script"
SHARED="$AS/shared/dash-auth.js"
BOUND="$HOME/Projects/support-report-bound"
MASTER="$HOME/Projects/cs-report-master-bound"

push() { # name dir deploymentId
  local name="$1" dir="$2" dep="$3"
  cp "$SHARED" "$dir/dash-auth.js"
  (cd "$dir" && clasp push -f >/dev/null && echo "pushed $name") 
  if [ -n "$dep" ]; then (cd "$dir" && clasp update-deployment "$dep" -d "$(date +%Y-%m-%d) $name" | tail -1); fi
}

want() { [ -z "${1:-}" ] || [ "$1" = "$2" ]; }
ONLY="${1:-}"

want "$ONLY" scorecards && push scorecards "$AS/scorecards" AKfycbyRXeF59TIeltQ27HSAIyDq7XMXOFZP_hdT7oq1v-TxJA7pdeQnfOl-QrptTxcw530iXg
want "$ONLY" firm && push firm-assignment "$AS/firm-assignment" AKfycbxkDLI7ldy0AtXq4iUjDB0b4MAdzkzJ0QSditt1sxFReXnoo5JPg8HzrC4feE1-flXyvg
want "$ONLY" loop && push loop-tracker "$AS/loop-tracker" AKfycbxQVzKZdB8ecIFscQUDX3uoL8CCzzH1qFiL3VtfJymAAwZPGulkn34MQi2sLt-b7NdN
want "$ONLY" mrr && push mrr-report "$AS/mrr-report" AKfycbxWBNVsOhP027_V8jpCJ52lja3iMtVehZlQUVG9T2g2k2PLt84bgU_JtENO24LNd0DD
want "$ONLY" contracts && push contracts "$AS/contracts" AKfycbzRJh5DWQxxDmkUAtyjKgvAlr2H0y758VlizVq09SkZ68EAoGEM2M9_m6CZoeVJg-xr9g
if want "$ONLY" bound; then
  cp "$AS/overrides.gs" "$BOUND/Code.js"
  cp "$AS/sync-accounts.gs" "$BOUND/sync-accounts.js"
  cp "$AS/implementation-sync.gs" "$BOUND/implementation-sync.js"
  cp "$AS/exclusions.gs" "$BOUND/exclusions.js"
  push support-report-bound "$BOUND" AKfycbz5hzP2ADpdQVN0bsV6h8TYZgj_snLQWeZgzYsZlDoJhdWv4WysfqlB2D0UX8TXrt9V8g
fi
if want "$ONLY" master; then
  cp "$AS/data-overrides.gs" "$MASTER/data-overrides.js"
  push cs-report-master "$MASTER" AKfycbxcel6P0QYZm8m3FKYDFtOOBLpRL6_KvrmIcS5ShrAbuTUPFXSrLtQ3SLDhrDeg6-pSww
fi
