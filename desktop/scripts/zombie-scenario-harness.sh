#!/usr/bin/env bash
# Zombie-defense e2e harness — boots the REAL dev app, kills it the way a
# given scenario would, and asserts the sidecar did not survive.
#
# Usage:
#   LISNA_RUN_ZOMBIE_HARNESS=1 scripts/zombie-scenario-harness.sh <scenario>|all
#
# Scenarios:
#   kill9-electron    SIGKILL Electron main   (jetsam / force-quit / kill -9 —
#                     scenarios 6, 8, 9: Layer A watchdog must reap)
#   sigterm-electron  SIGTERM Electron main   (Activity Monitor "Quit", logout —
#                     Layer B signal handler must run bounded shutdown)
#   kill9-launcher    SIGKILL the electron-vite launcher tree (scenario 13).
#                     NOTE: Electron itself survives launcher death by design —
#                     it is a VISIBLE app the user can quit; the assertion here
#                     is "sidecar's fate tracks Electron's", so after we then
#                     kill the surviving Electron, the sidecar must die with it.
#
# Gated behind LISNA_RUN_ZOMBIE_HARNESS=1: boots a real GUI app, takes ~30s
# per scenario, not for default CI.
set -uo pipefail

if [ "${LISNA_RUN_ZOMBIE_HARNESS:-0}" != "1" ]; then
  echo "skip: set LISNA_RUN_ZOMBIE_HARNESS=1 to run (boots the real dev app)"
  exit 0
fi

cd "$(dirname "$0")/.."  # desktop/

SIDECAR_PATTERN='resources/sidecar$'
ELECTRON_PATTERN='Electron\.app/Contents/MacOS/Electron \.'

cleanup() {
  pkill -9 -f "$SIDECAR_PATTERN" 2>/dev/null || true
  pkill -9 -f "$ELECTRON_PATTERN" 2>/dev/null || true
  pkill -9 -f 'electron-vite dev' 2>/dev/null || true
  [ -n "${DEV_PID:-}" ] && kill -9 "$DEV_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

boot_dev_app() {
  pnpm dev >/tmp/zombie-harness-dev.log 2>&1 &
  DEV_PID=$!
  # Wait for the sidecar to appear (boot is light — no model load).
  for _ in $(seq 1 60); do
    SIDE=$(pgrep -f "$SIDECAR_PATTERN" | head -1 || true)
    [ -n "$SIDE" ] && break
    sleep 1
  done
  if [ -z "${SIDE:-}" ]; then
    echo "❌ SETUP FAIL: sidecar never appeared (see /tmp/zombie-harness-dev.log)"
    return 1
  fi
  ELECTRON=$(pgrep -f "$ELECTRON_PATTERN" | head -1 || true)
  echo "  booted: electron=$ELECTRON sidecar=$SIDE"
}

assert_sidecar_dead() {
  local label=$1 deadline_s=$2
  for _ in $(seq 1 $((deadline_s * 10))); do
    if ! kill -0 "$SIDE" 2>/dev/null; then
      echo "✅ PASS [$label] — sidecar $SIDE gone"
      return 0
    fi
    sleep 0.1
  done
  echo "❌ FAIL [$label] — sidecar $SIDE still alive after ${deadline_s}s:"
  ps -p "$SIDE" -o pid,ppid,rss,command || true
  kill -9 "$SIDE" 2>/dev/null || true
  return 1
}

run_scenario() {
  local scenario=$1 rc=0
  echo "── scenario: $scenario ──"
  boot_dev_app || return 1
  case "$scenario" in
    kill9-electron)
      kill -9 "$ELECTRON"
      # Layer A watchdog: 500ms poll + margin.
      assert_sidecar_dead "$scenario" 3 || rc=1
      ;;
    sigterm-electron)
      kill -TERM "$ELECTRON"
      # Layer B: bounded shutdown is ≤2s + app teardown margin.
      assert_sidecar_dead "$scenario" 5 || rc=1
      ;;
    kill9-launcher)
      kill -9 "$DEV_PID" 2>/dev/null || true
      pkill -9 -f 'electron-vite dev' 2>/dev/null || true
      sleep 2
      # Electron survives launcher death (visible app, user-quittable — not
      # a silent zombie). The invariant: sidecar fate tracks Electron's.
      if ! kill -0 "$SIDE" 2>/dev/null; then
        echo "  (sidecar already gone with launcher — also fine)"
        echo "✅ PASS [$scenario]"
      else
        ELECTRON_NOW=$(pgrep -f "$ELECTRON_PATTERN" | head -1 || true)
        if [ -z "$ELECTRON_NOW" ]; then
          echo "❌ FAIL [$scenario] — Electron dead but sidecar survived"
          rc=1
        else
          echo "  Electron survived launcher death (expected, visible app) — killing it now"
          kill -9 "$ELECTRON_NOW"
          assert_sidecar_dead "$scenario" 3 || rc=1
        fi
      fi
      ;;
    *)
      echo "unknown scenario: $scenario"
      rc=1
      ;;
  esac
  cleanup
  sleep 1
  return "$rc"
}

FAILED=0
if [ "${1:-all}" = "all" ]; then
  for s in kill9-electron sigterm-electron kill9-launcher; do
    run_scenario "$s" || FAILED=1
  done
else
  run_scenario "$1" || FAILED=1
fi

exit "$FAILED"
