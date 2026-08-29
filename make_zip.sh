#!/usr/bin/env bash
# Create a zip of the site suitable for manual upload to a static host
set -euo pipefail
OUT=${1:-palmvilla.zip}
zip -r "$OUT" . -x '*.git*' -x 'node_modules/*'

echo "Created $OUT"