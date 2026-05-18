#!/usr/bin/env bash
# JOBS 환경변수로 병렬도 제어 (디폴트 2). M1 8GB 에서 swap 없이 동작하는 안전 상한.
# RAM 여유 머신은 `JOBS=8 ./scripts/build.sh` 처럼 override.
# 디폴트를 -j (all-cores) 로 두지 않는 이유: M1 8GB 에서 swap thrash → 빌드 매크로 단계 OOM 이력.
set -euo pipefail
cd "$(dirname "$0")/.."
MODE="${1:-build}"
JOBS="${JOBS:-2}"

if [[ "$MODE" == "test" ]]; then
  BUILD_DIR="build/test"
  mkdir -p "$BUILD_DIR" && cd "$BUILD_DIR"
  cmake ../.. -DCMAKE_BUILD_TYPE=Debug -DLISNA_WITH_TESTS=ON
  cmake --build . -j "$JOBS" --target sidecar_tests
  ctest --output-on-failure
else
  BUILD_DIR="build/release"
  mkdir -p "$BUILD_DIR" && cd "$BUILD_DIR"
  cmake ../.. -DCMAKE_BUILD_TYPE=Release
  cmake --build . -j "$JOBS"
  mkdir -p ../../../resources
  cp lisna_sidecar ../../../resources/sidecar
  chmod +x ../../../resources/sidecar
fi
