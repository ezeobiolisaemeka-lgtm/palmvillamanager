#!/usr/bin/env bash
# Simple deploy script for Netlify using netlify-cli
# Usage: ensure `netlify` CLI is installed and you're logged in: `netlify login`

set -euo pipefail
DIR="${1:-.}"
if ! command -v netlify >/dev/null 2>&1; then
  echo "netlify CLI not found. Install with: npm i -g netlify-cli"
  exit 1
fi

# Deploy as draft first
netlify deploy --dir="$DIR"

echo "If the draft looks good, run: netlify deploy --prod --dir=$DIR"