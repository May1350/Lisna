/**
 * Vitest globalSetup — L2 defense against orphan `llama-completion`
 * processes. Companion to the per-test `afterAll` (L1) and the
 * `scripts/test-with-cleanup.sh` shell trap (L3).
 *
 * - L1: per-test afterAll pkill (`spikes/.../round-trip.test.ts`,
 *   `src/integration/lecture-30min-stress.real.test.ts`, etc.) — runs
 *   when tests complete normally.
 * - L2 (this file): vitest globalSetup. Pre-test sweep catches leftover
 *   zombies from PRIOR crashed runs. Teardown sweep catches the case
 *   where a per-test afterAll itself threw (afterAll's own failure
 *   doesn't propagate to other tests' cleanup).
 * - L3: shell trap (`scripts/test-with-cleanup.sh`) covers external
 *   kill (SIGINT/SIGTERM/SIGHUP). Nothing covers SIGKILL.
 *
 * Founder observed 2.31 GB orphan llama-completion in Activity Monitor
 * on 2026-06-09 during a verify run — on 8 GB M1 that risks swap
 * thrash → kernel panic per `.claude/rules/pitfalls.md (spike-llm)`.
 */
import { execSync } from 'node:child_process';

function pkillSweep(): void {
  try {
    execSync('pkill -9 -f llama-completion', { stdio: 'ignore' });
  } catch {
    /* no zombies = happy path; pkill returns non-zero when no match */
  }
  // Orphaned production-sidecar processes (ppid==1: their Electron/test
  // parent died). The ppid guard means a founder's LIVE dev-app sidecar
  // (parent = Electron, alive) is never touched, while binaries leaked by
  // crashed integration tests or dev runs are reaped. Belt-and-suspenders
  // with the in-binary parent watchdog (Layer A) — this also catches
  // pre-watchdog binaries still on disk.
  // Pattern anchored at end-of-line: the binary runs with no args, so its
  // command line ENDS with the path; bash wrappers that merely contain it
  // (e.g. integration-test middles) don't match.
  try {
    const out = execSync('pgrep -f "resources/sidecar$" || true', { encoding: 'utf8' });
    for (const pidStr of out.trim().split('\n').filter(Boolean)) {
      const ppid = execSync(`ps -o ppid= -p ${pidStr} || true`, { encoding: 'utf8' }).trim();
      if (ppid === '1') {
        try { process.kill(Number(pidStr), 'SIGKILL'); } catch { /* gone */ }
      }
    }
  } catch {
    /* sweep is best-effort */
  }
}

export default function setup(): () => void {
  pkillSweep();        // pre-run: clean up from prior crashed runs
  return pkillSweep;   // post-run: clean up any survivors
}
