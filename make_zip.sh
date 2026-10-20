#!/usr/bin/env bash
# Create a source archive for a Node.js host. Never include credentials or data.
set -euo pipefail
OUT=${1:-palmvilla.zip}
zip -r "$OUT" . \
  -x '*/.git/*' '.git/*' \
  -x '.env' '.env.*' \
  -x 'node_modules/*' '*/node_modules/*' \
  -x 'data/*' 'backups/*' '../palmvilla-data/*' '../palmvilla-backups/*' \
  -x '*.sqlite' '*.sqlite-shm' '*.sqlite-wal' \
  -x 'current_tunnel_url.txt' 'ngrok' 'ngrok.zip' 'ngrok-download.html' \
  -x "$OUT"
zip -u "$OUT" .env.example

echo "Created $OUT"
