#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build
for w in fluxo-request fluxo-settle; do
  cre workflow build "./$w" --target simulation-settings -o "build/$w.wasm"
done
