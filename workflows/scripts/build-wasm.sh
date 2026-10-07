#!/usr/bin/env bash
# Compiles every workflow to build/<name>.wasm once, so each simulation can pass
# --wasm "$PWD/build/<name>.wasm" and skip the ~5 s TypeScript→WASM compile.
# Rerun after changing any workflow or lib/ file. Run from workflows/.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build
for w in brizo-spend brizo-infer brizo-settle brizo-request; do
  cre workflow build "./$w" --target simulation-settings -o "build/$w.wasm"
done
