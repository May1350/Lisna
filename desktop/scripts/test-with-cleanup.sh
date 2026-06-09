#!/usr/bin/env bash
# Wrap vitest with a trap so external kill (CI timeout / Ctrl-C / parent
# shell exit) still pkills any orphan llama-completion subprocess. The
# per-test `afterAll` in spike/integration test files handles the normal
# happy path; this is the L3 fail-safe for the abnormal exit modes
# (SIGTERM/SIGINT/SIGHUP). Nothing can protect against SIGKILL, but
# everything else is covered.
#
# Founder observed a 2.31 GB orphan llama-completion in Activity Monitor
# during a verify run on 2026-06-09 (memory: see the v2_30min_real_record
# + v2_alpha_v0.1.1 incidents — orphans on an 8GB M1 = swap thrash =
# kernel panic risk per `.claude/rules/pitfalls.md (spike-llm)`).
#
# Trap on EXIT covers normal vitest termination AND any catchable signal
# (INT TERM HUP). `pkill -9 -f` is best-effort (non-zero when no match).
# `exec vitest` replaces the bash shell so vitest inherits the test pid
# and our trap stays installed via the shell process's EXIT handler in
# the parent — actually `exec` REPLACES this process so the trap is
# lost. Use a foreground job instead so the trap survives.
set -uo pipefail

cleanup() {
  pkill -9 -f llama-completion 2>/dev/null || true
}
trap cleanup EXIT INT TERM HUP

# Run vitest as a child so this shell's trap fires after it exits.
# Forward exit code so CI sees the real test result.
node_modules/.bin/vitest run --passWithNoTests "$@"
EXIT_CODE=$?
exit "$EXIT_CODE"
