#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build && cd build
cmake .. -DCMAKE_BUILD_TYPE=Release
cmake --build . -j
mkdir -p ../../resources
cp lisna_sidecar ../../resources/sidecar
chmod +x ../../resources/sidecar
