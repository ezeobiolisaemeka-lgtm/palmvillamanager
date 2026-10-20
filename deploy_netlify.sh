#!/usr/bin/env bash
set -euo pipefail
cat >&2 <<'NOTICE'
Palm Villa now requires its Node.js API and persistent SQLite storage.
This static Netlify deploy helper is disabled to avoid publishing a non-working
or unprotected static copy. Deploy the Node server to a host with persistent
storage, and point your custom domain at that server.
NOTICE
exit 1
