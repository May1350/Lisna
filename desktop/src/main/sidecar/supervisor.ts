import { spawn, type ChildProcess } from 'node:child_process';
import { app } from 'electron';
import { join } from 'node:path';
import { SidecarClient } from './client';

interface SupervisorOptions {
  /** Called when the sidecar has crashed `maxConsecutiveFailures` times in a row and the supervisor is giving up. */
  onCrash: (msg: string) => void;
  /**
   * Called on EVERY unexpected sidecar exit (before respawn is scheduled).
   * Fires once per exit, including the give-up case. NOT called during a
   * graceful `shutdown()` (gated by the `shuttingDown` flag).
   *
   * Use this for stateful subscribers (e.g. ipc.ts) that need to clear
   * session state and notify the renderer. The single-source-of-truth for
   * "sidecar is no longer usable, in-flight ops are dead." `onCrash` is
   * demoted to a log-only signal — both fire on give-up but `onExit` fires
   * first.
   */
  onExit?: () => void;
  /** Default 2 — fail-fast policy: a binary that won't survive its own startup twice in a row likely won't on the third try either. */
  maxConsecutiveFailures?: number;
  /** Default 500ms — short backoff between crash and respawn so transient OS hiccups (file lock, etc.) settle. */
  restartDelayMs?: number;
  /**
   * If the sidecar runs cleanly for this long without exiting, reset the
   * consecutive-failure counter. Default 60s — 30s was too aggressive: a
   * `29s alive → crash → 29s alive → crash` sequence would hit the 2-strike
   * give-up after only ~60s of total uptime, which a transient hiccup during
   * model warmup can plausibly cause.
   */
  healthyUptimeResetMs?: number;
}

/**
 * Spawns and supervises the sidecar binary. Owns lifecycle (start / crash
 * detection / restart with backoff / graceful shutdown). Wraps the child
 * process in a `SidecarClient` and hands it back to callers — the supervisor
 * itself never speaks the IPC protocol.
 *
 * Restart policy: respawn on unexpected exit, with a 2-strike give-up. After
 * a healthy uptime window, the failure counter resets so a long-lived process
 * that crashes once after hours of work doesn't bypass straight to give-up.
 */
export class SidecarSupervisor {
  private proc?: ChildProcess;
  private client?: SidecarClient;
  private failuresInARow = 0;
  private healthyResetTimer?: NodeJS.Timeout;
  private shuttingDown = false;
  /** Monotonically incremented on each `start()` call. Closures capture the
   * generation at the time of spawn; stale exit-listeners are silently ignored. */
  private generation = 0;
  private readonly onCrash: (msg: string) => void;
  private readonly onExit?: () => void;
  private readonly maxFailures: number;
  private readonly restartDelayMs: number;
  private readonly healthyUptimeResetMs: number;

  constructor(opts: SupervisorOptions) {
    this.onCrash = opts.onCrash;
    this.onExit = opts.onExit;
    this.maxFailures = opts.maxConsecutiveFailures ?? 2;
    this.restartDelayMs = opts.restartDelayMs ?? 500;
    this.healthyUptimeResetMs = opts.healthyUptimeResetMs ?? 60_000;
  }

  /**
   * Resolve the path to the sidecar binary. In packaged builds the binary
   * lives under `process.resourcesPath/sidecar` (electron-builder ships
   * `extraResources` there). In dev / unpackaged runs it lives at
   * `<appPath>/resources/sidecar`.
   */
  private resolveBinPath(): string {
    return app.isPackaged
      ? join(process.resourcesPath, 'sidecar')
      : join(app.getAppPath(), 'resources', 'sidecar');
  }

  /** Spawn the sidecar. Idempotent: returns the existing client if already running. */
  start(): SidecarClient {
    if (this.client) return this.client;
    const bin = this.resolveBinPath();
    this.proc = spawn(bin, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    // CRITICAL ORDER INVARIANT: SidecarClient must register its own
    // proc.on('exit', rejectAllPending) listener BEFORE supervisor's
    // proc.on('exit', handleExit) is attached. Node emits listeners in
    // registration order, so client's pending-rejection fires first when
    // the sidecar crashes — that lets any in-flight orch.stop() / orch.onChunk()
    // reject synchronously and run their `finally` (which clears
    // ipc.ts module state) BEFORE supervisor's handleExit calls onExit →
    // handleSidecarExit. Without this order, handleSidecarExit would clobber
    // state mid-finally and push session/error while the renderer already saw
    // a handler rejection. Do not reorder.
    this.client = new SidecarClient(this.proc);
    const gen = ++this.generation;
    this.proc.on('exit', (code, sig) => this.handleExit(code, sig, gen));
    this.proc.on('error', (err) => console.error('[sidecar spawn error]', err));
    // After a healthy uptime window, reset the failure counter so isolated
    // crashes much later don't immediately push us to the give-up threshold.
    this.healthyResetTimer = setTimeout(() => {
      this.failuresInARow = 0;
    }, this.healthyUptimeResetMs);
    return this.client;
  }

  /** Current client, or undefined if no sidecar is running. */
  getClient(): SidecarClient | undefined {
    return this.client;
  }

  private handleExit(
    code: number | null,
    sig: NodeJS.Signals | null,
    spawnGeneration: number,
  ): void {
    // Guard: stale exit-listeners from a previous spawn cycle (possible when
    // the test mock returns the same ChildProcess object for every spawn() call)
    // must not double-fire onExit/onCrash. The generation counter monotonically
    // increments with each start(); the current generation only matches the
    // latest spawn.
    if (spawnGeneration !== this.generation) return;
    if (this.healthyResetTimer) {
      clearTimeout(this.healthyResetTimer);
      this.healthyResetTimer = undefined;
    }
    this.client = undefined;
    this.proc = undefined;
    if (this.shuttingDown) return; // expected exit during shutdown()
    // onExit fires AFTER the shuttingDown gate (so deliberate teardown
    // doesn't trigger false crash signals) and BEFORE the failure-counter
    // logic (so ipc.ts can clean up before a respawn schedules).
    this.onExit?.();
    this.failuresInARow += 1;
    if (this.failuresInARow >= this.maxFailures) {
      this.onCrash(
        `Sidecar exited ${this.failuresInARow} times in a row (last code=${code} sig=${sig})`,
      );
      return;
    }
    setTimeout(() => {
      if (!this.shuttingDown) this.start();
    }, this.restartDelayMs);
  }

  /** SIGTERM the sidecar, escalate to SIGKILL after 1s, await full exit. */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.healthyResetTimer) clearTimeout(this.healthyResetTimer);
    const proc = this.proc;
    if (!proc) return;
    proc.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {
          /* already gone */
        }
        resolve();
      }, 1000);
      proc.once('exit', () => {
        clearTimeout(t);
        resolve();
      });
    });
  }
}
