import { spawn, type ChildProcess } from 'node:child_process';
import { app } from 'electron';
import { join } from 'node:path';
import { SidecarClient } from './client';

interface SupervisorOptions {
  /** Called when the sidecar has crashed `maxConsecutiveFailures` times in a row and the supervisor is giving up. */
  onCrash: (msg: string) => void;
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
  private readonly onCrash: (msg: string) => void;
  private readonly maxFailures: number;
  private readonly restartDelayMs: number;
  private readonly healthyUptimeResetMs: number;

  constructor(opts: SupervisorOptions) {
    this.onCrash = opts.onCrash;
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
    this.client = new SidecarClient(this.proc);
    this.proc.on('exit', (code, sig) => this.handleExit(code, sig));
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

  private handleExit(code: number | null, sig: NodeJS.Signals | null): void {
    if (this.healthyResetTimer) {
      clearTimeout(this.healthyResetTimer);
      this.healthyResetTimer = undefined;
    }
    this.client = undefined;
    this.proc = undefined;
    if (this.shuttingDown) return; // expected exit during shutdown()
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
