#!/usr/bin/env bash
# Runs brizo-settle on its cron cadence for the simulation-only system.
#
# A deployed DON would fire brizo-settle's cron trigger ("0 */10 * * * *") itself;
# `cre workflow simulate` fires a cron trigger exactly once per run. This loop
# stands in for the DON scheduler: every INTERVAL seconds (default 600) it runs one
# broadcast simulation, which pays the operator for spends finalized since the
# last settle. A settle with nothing owed is harmless (it transfers 0).
#
# Usage (from workflows/, after scripts/build-wasm.sh):
#   ./scripts/settle-loop.sh            # every 10 minutes until stopped
#   INTERVAL=60 ./scripts/settle-loop.sh
set -uo pipefail
cd "$(dirname "$0")/.."
INTERVAL="${INTERVAL:-600}"
WASM="$PWD/build/brizo-settle.wasm"
[ -f "$WASM" ] || { echo "missing $WASM; run scripts/build-wasm.sh first" >&2; exit 1; }

while true; do
  result=$(cre workflow simulate ./brizo-settle --target simulation-settings --non-interactive \
    --trigger-index 0 --broadcast --wasm "$WASM" 2>&1 | grep -E '^"|✗' | tail -1)
  echo "$(date -u +%FT%TZ) settle: ${result:-no result}"
  sleep "$INTERVAL"
done
