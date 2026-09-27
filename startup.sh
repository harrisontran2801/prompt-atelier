#!/bin/sh
# Restart contract: directory of this script, not a hard-coded workspace path.
set -e
ROOT=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
cd "$ROOT"
if curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/; then
  exit 0
fi
# Local-first: auth stays off. Vite is invoked directly, not via npm.
export VITE_AUTH_ENABLED="${VITE_AUTH_ENABLED:-false}"
./node_modules/.bin/vite dev --host 0.0.0.0 --port 8080 > /tmp/atelier-dev.log 2>&1 &
exit 0
