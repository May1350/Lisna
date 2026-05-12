#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
MODE="${1:-build}"
mkdir -p build && cd build

if [[ "$MODE" == "test" ]]; then
  cmake .. -DCMAKE_BUILD_TYPE=Debug -DLISNA_WITH_TESTS=ON
  cmake --build . -j --target sidecar_tests
  ctest --output-on-failure
else
  cmake .. -DCMAKE_BUILD_TYPE=Release
  cmake --build . -j
  mkdir -p ../../resources
  cp lisna_sidecar ../../resources/sidecar
  chmod +x ../../resources/sidecar
fi
