#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STIM_SRC="$SCRIPT_DIR/../third_party/Stim/src"
OUT="$SCRIPT_DIR/out"
mkdir -p "$OUT"
if ! command -v em++ >/dev/null 2>&1; then
  echo "ERROR: em++ not found. Run: source \$HOME/emsdk/emsdk_env.sh" >&2
  exit 1
fi
SOURCES=$(find "$STIM_SRC/stim" -name '*.cc' \
  ! -name '*.test.cc' ! -name '*.perf.cc' ! -name '*.pybind.cc' \
  ! -name 'main.cc')
em++ -std=c++20 -O2 -fexceptions \
  -I "$STIM_SRC" \
  "$SCRIPT_DIR/binding.cpp" $SOURCES \
  -lembind \
  -sMODULARIZE=1 \
  -sEXPORT_NAME=createStimModule \
  -sENVIRONMENT=node \
  -sALLOW_MEMORY_GROWTH=1 \
  -o "$OUT/stim_diagram.js"
echo "Built $OUT/stim_diagram.js + stim_diagram.wasm"
