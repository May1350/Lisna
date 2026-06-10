#!/usr/bin/env bash
# Post-verify assertion: no `llama-completion` or other heavy LLM
# zombies survived the test run. If any process is alive, FAIL loudly
# so the developer notices BEFORE walking away from the machine.
#
# Catches the case where every defensive layer (per-test afterAll +
# vitest globalSetup teardown + scripts/test-with-cleanup.sh trap)
# silently failed but the test exited 0.
#
# Founder incident 2026-06-09: 2.31 GB orphan llama-completion in
# Activity Monitor on 8GB M1 → swap thrash → kernel panic risk.
set -uo pipefail

FAIL=0

ZOMBIES=$(pgrep -f llama-completion || true)
if [ -n "$ZOMBIES" ]; then
  echo "❌ LLAMA-COMPLETION ZOMBIES SURVIVED VERIFY:" >&2
  ps -ef | grep -E "llama-completion" | grep -v grep >&2
  echo "" >&2
  echo "Killing them now to avoid kernel-panic risk:" >&2
  pkill -9 -f llama-completion 2>/dev/null || true
  echo "Then failing verify so the leak gets investigated." >&2
  FAIL=1
fi

# Orphaned production sidecars (ppid==1 — their Electron/test parent died).
# ppid guard: a live dev-app sidecar (parent = running Electron) is fine and
# must NOT fail verify; only true orphans count. With the in-binary parent
# watchdog (Layer A, 2026-06-10) these should self-exit within 500ms — an
# orphan here means the watchdog regressed or a pre-watchdog binary leaked.
# Pattern anchored at end-of-line: the binary runs with no args, so its full
# command line ENDS with the path — bash wrappers / editors whose command
# line merely CONTAINS the path don't match.
for PID in $(pgrep -f "resources/sidecar$" || true); do
  PPID_VAL=$(ps -o ppid= -p "$PID" 2>/dev/null | tr -d ' ')
  if [ "$PPID_VAL" = "1" ]; then
    echo "❌ ORPHANED SIDECAR SURVIVED VERIFY (pid=$PID, ppid=1):" >&2
    ps -p "$PID" -o pid,ppid,rss,command >&2
    kill -9 "$PID" 2>/dev/null || true
    FAIL=1
  fi
done

exit "$FAIL"
