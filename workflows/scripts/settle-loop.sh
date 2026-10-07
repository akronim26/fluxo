#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/.."
INTERVAL="${INTERVAL:-600}"
WASM="$PWD/build/fluxo-settle.wasm"
[ -f "$WASM" ] || { echo "missing $WASM; run scripts/build-wasm.sh first" >&2; exit 1; }

while true; do
  result=$(cre workflow simulate ./fluxo-settle --target simulation-settings --non-interactive \
    --trigger-index 0 --broadcast --wasm "$WASM" 2>&1 | grep -E '^"|✗' | tail -1)
  echo "$(date -u +%FT%TZ) settle: ${result:-no result}"
  sleep "$INTERVAL"
done
