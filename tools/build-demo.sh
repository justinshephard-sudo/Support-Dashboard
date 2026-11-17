#!/bin/bash
# Builds the shareable TEST SITE (made-up data, no sign-in) into $1 (default: ./demo-build).
# js/demo.js answers every request in the browser; the live dashboard never loads it.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-demo-build}"
rm -rf "$OUT" && mkdir -p "$OUT"
cp -R style.css js assets services "$OUT/"
python3 - "$OUT" <<'PY'
import re, sys
out = sys.argv[1]
s = open('index.html').read()
s = s.replace('<script src="https://accounts.google.com/gsi/client" async defer></script>\n', '')
s = re.sub(r'<title>[^<]*</title>', '<title>CS Dashboard Test Site</title>', s)
# The test data goes in first, before any other script runs.
s = s.replace('<link rel="stylesheet"', '<script src="js/demo-support.js"></script>\n<script src="js/demo.js"></script>\n<link rel="stylesheet"', 1)
open(out + '/index.html', 'w').write(s)
PY
echo "built $OUT ($(du -sh "$OUT" | cut -f1))"
