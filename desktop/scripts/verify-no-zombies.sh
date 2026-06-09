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

ZOMBIES=$(pgrep -f llama-completion || true)
if [ -n "$ZOMBIES" ]; then
  echo "❌ LLAMA-COMPLETION ZOMBIES SURVIVED VERIFY:" >&2
  ps -ef | grep -E "llama-completion" | grep -v grep >&2
  echo "" >&2
  echo "Killing them now to avoid kernel-panic risk:" >&2
  pkill -9 -f llama-completion 2>/dev/null || true
  echo "Then failing verify so the leak gets investigated." >&2
  exit 1
fi
exit 0
