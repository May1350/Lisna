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

  # ─── Bundle native dylibs for the packaged .app (P0 2026-06-10) ─────────
  #
  # Without this step, the sidecar binary's @rpath points to build-host-
  # specific absolute paths (e.g. `/Users/runner/work/...` on the CI builder,
  # `/Users/guntak/.../build/release/bin` on the dev machine). The dev build
  # works "by accident" because the local path exists; the .app shipped to
  # users has no such path → dyld fails → SIGABRT → "録音エンジンを復旧
  # できませんでした" red banner on first record attempt. See memory
  # v2_alpha_v0.1.1_sidecar_bundling_bug_2026-06-09.
  #
  # Fix: copy all dependent dylibs into ../../../resources/dylibs/ AND patch
  # rpath so the sidecar binary looks for them at @executable_path/dylibs
  # (resolves to Lisna.app/Contents/Resources/dylibs/ when packaged, and to
  # desktop/resources/dylibs/ in dev). Each dylib gets @loader_path so it
  # can find its sibling dylibs in the same directory. Both rpath edits
  # invalidate the ad-hoc signature → resign with `codesign -s -`.
  #
  # Idempotent: re-runs of build.sh detect existing rpath via `otool -l`
  # and skip the install_name_tool + codesign steps to keep the script
  # cheap.

  DYLIBS_DST="../../../resources/dylibs"
  mkdir -p "$DYLIBS_DST"
  # -P preserves symlinks (libwhisper.1.dylib → libwhisper.1.8.4.dylib).
  # Both the symlink AND the real file are required for @rpath resolution.
  cp -P deps/whisper.cpp/src/libwhisper*.dylib "$DYLIBS_DST/" 2>/dev/null || true
  cp -P bin/libggml*.dylib bin/libllama*.dylib "$DYLIBS_DST/" 2>/dev/null || true

  SIDECAR_BIN="../../../resources/sidecar"
  if ! otool -l "$SIDECAR_BIN" | grep -q "@executable_path/dylibs"; then
    install_name_tool -add_rpath "@executable_path/dylibs" "$SIDECAR_BIN"
    codesign --force --sign - "$SIDECAR_BIN"
  fi

  for LIB in "$DYLIBS_DST"/*.dylib; do
    # Skip symlinks — only patch the real files (rpath lives in the real Mach-O).
    [ -L "$LIB" ] && continue
    if ! otool -l "$LIB" | grep -q "@loader_path\b"; then
      install_name_tool -add_rpath "@loader_path" "$LIB"
      codesign --force --sign - "$LIB"
    fi
  done
fi
