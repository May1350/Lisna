import { describe, it, expect, afterEach } from 'vitest';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { resolve as resolvePath, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sidecarPath = resolvePath(__dirname, '../../../../resources/sidecar');

// Zombie-defense Layer A (2026-06-10): the sidecar must self-exit when its
// parent dies WITHOUT closing stdin — jetsam / SIGKILL / crash of Electron
// never delivers pipe EOF, and pre-watchdog binaries sat in getline forever
// holding ~3 GB (founder-reported 10+ times). The watchdog polls getppid()
// every 500ms and _Exit(0)s on re-parent.
//
// 3-process chain: vitest (this) → middle bash → sidecar. We SIGKILL the
// middle so the sidecar is orphaned while ITS stdin pipe (held by a `sleep`
// process substitution, not by the middle) stays open — exactly the shape
// where pipe-EOF-based shutdown never fires and only the watchdog saves us.
describe.skipIf(!existsSync(sidecarPath))('sidecar parent watchdog (real binary)', () => {
  let middle: ChildProcess | undefined;

  const sidecarPids = (): number[] =>
    execSync(`pgrep -f "${sidecarPath}" || true`, { encoding: 'utf8' })
      .trim().split('\n').filter(Boolean).map(Number);

  afterEach(() => {
    try { middle?.kill('SIGKILL'); } catch { /* gone */ }
    // Reap any survivor so a FAILING run can't leak the very zombie this
    // test exists to prevent.
    for (const pid of sidecarPids()) {
      try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
    }
  });

  it('self-exits within 1.5s when the parent is SIGKILLed', async () => {
    const before = sidecarPids();
    middle = spawn('bash', ['-c', `"${sidecarPath}" < <(sleep 600) >/dev/null 2>&1 & sleep 600`], {
      stdio: 'ignore',
    });
    // Wait for the sidecar grandchild to appear.
    let side: number | undefined;
    for (let i = 0; i < 50 && side === undefined; i++) {
      await new Promise((r) => setTimeout(r, 100));
      side = sidecarPids().find((p) => !before.includes(p));
    }
    expect(side, 'sidecar grandchild should spawn').toBeDefined();

    middle.kill('SIGKILL');

    // Watchdog poll interval is 500ms; allow 3 polls of margin.
    const deadline = Date.now() + 1500;
    let alive = true;
    while (alive && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
      try {
        process.kill(side!, 0); // signal 0 = existence probe
      } catch {
        alive = false;
      }
    }
    expect(alive, `sidecar ${side} must self-exit after parent death`).toBe(false);
  }, 15_000);

  it('exits cleanly on stdin EOF (normal shutdown path unchanged)', async () => {
    const proc = spawn(sidecarPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    const exited = new Promise<void>((resolve) => proc.once('exit', () => resolve()));
    // Give it a beat to boot, then close stdin — the getline loop must end.
    await new Promise((r) => setTimeout(r, 300));
    proc.stdin!.end();
    await expect(
      Promise.race([
        exited,
        new Promise((_, rej) => setTimeout(() => rej(new Error('no exit within 3s')), 3000)),
      ]),
    ).resolves.toBeUndefined();
  }, 10_000);
});
