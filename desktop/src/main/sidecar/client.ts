import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { SidecarRequest, SidecarResponse, SidecarEvent } from '@shared/ipc-protocol';

type Pending = {
  resolve: (r: SidecarResponse) => void;
  reject: (e: Error) => void;
  /**
   * Timeout handle, or null when the caller passed `timeoutMs: Infinity`.
   * Modeling absent-by-design as `null` (instead of an unobservable 24.8-day
   * dummy timer) keeps the code honest and avoids Node's silent coercion of
   * over-max delays to 1ms.
   */
  timer: NodeJS.Timeout | null;
};

interface SendOptions {
  /**
   * Reject after this many ms with a timeout Error. Pass `Infinity` for ops
   * with no reasonable upper bound (e.g. model load on a cold filesystem).
   * Default: 5000.
   */
  timeoutMs?: number;
}

/**
 * Distributive `Omit` — TS's stock `Omit<T, K>` does not distribute over a
 * discriminated union; it flattens to an intersection of common props,
 * dropping per-variant fields like `kind` / `path` / `language`. This variant
 * applies `Omit` to each constituent in turn so callers can pass any
 * `SidecarRequest` variant without `id` and keep its variant-specific keys.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A `SidecarRequest` minus its `id` — the public `send()` argument shape. */
export type SidecarSendRequest = DistributiveOmit<SidecarRequest, 'id'>;

/**
 * Thin TS wrapper over the sidecar binary's stdio.
 *
 * Responsibilities:
 *  - Parse NDJSON line-by-line from stdout (handling chunk splits / merges).
 *  - Match id-bearing lines to pending `send()` requests; resolve their promise.
 *  - Dispatch id-less lines to `onEvent` listeners (ready/log/memory).
 *  - Surface raw lines to `onRawLine` listeners (debugging / test introspection).
 *  - Reject all pending requests if the process exits while they're waiting.
 *
 * The class is process-agnostic: it does not spawn or manage lifecycle. That's
 * `SidecarSupervisor`'s job. This separation keeps the client unit-testable
 * against any line-buffered child (e.g. `/bin/cat`).
 */
export class SidecarClient {
  private buf = '';
  private pending = new Map<string, Pending>();
  private rawLineListeners: ((l: string) => void)[] = [];
  private eventListeners: ((e: SidecarEvent) => void)[] = [];

  constructor(private proc: ChildProcess) {
    if (!proc.stdout || !proc.stdin) {
      throw new Error('SidecarClient: child process must have piped stdio');
    }
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk: string) => this.onData(chunk));
    proc.stderr?.on('data', (d) => console.error('[sidecar stderr]', d.toString()));
    // Without this listener, an EPIPE on `stdin.write` after the sidecar has
    // closed its end becomes an unhandled `'error'` event and crashes the main
    // process. Phase 3's high request volume will eventually race a shutdown.
    proc.stdin.on('error', (err) => console.error('[sidecar stdin error]', err));
    proc.on('exit', () => this.rejectAllPending(new Error('sidecar process exited')));
  }

  /** Subscribe to every non-empty stdout line, pre-JSON-parse. Returns an unsubscribe fn. */
  onRawLine(cb: (l: string) => void): () => void {
    this.rawLineListeners.push(cb);
    return () => {
      this.rawLineListeners = this.rawLineListeners.filter((x) => x !== cb);
    };
  }

  /** Subscribe to id-less event lines (ready/log/memory). Returns an unsubscribe fn. */
  onEvent(cb: (e: SidecarEvent) => void): () => void {
    this.eventListeners.push(cb);
    return () => {
      this.eventListeners = this.eventListeners.filter((x) => x !== cb);
    };
  }

  /**
   * Send a request and await its id-matched response. Generates a UUID for
   * the request id internally so the caller never has to. Rejects on timeout
   * (default 5000ms) — always, so callers can't silently hang. Pass
   * `timeoutMs: Infinity` for genuinely unbounded ops.
   */
  send(req: SidecarSendRequest, opts: SendOptions = {}): Promise<SidecarResponse> {
    const id = randomUUID();
    const full = JSON.stringify({ id, ...req });
    const timeoutMs = opts.timeoutMs ?? 5000;
    return new Promise((resolve, reject) => {
      const timer: NodeJS.Timeout | null =
        timeoutMs === Infinity
          ? null
          : setTimeout(() => {
              this.pending.delete(id);
              reject(new Error(`sidecar request ${id} timed out after ${timeoutMs}ms`));
            }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin!.write(full + '\n');
    });
  }

  /**
   * Wait for the next `ready` event the sidecar emits on startup. Resolves
   * with the ready event payload, rejects if the process exits first or if
   * the wait exceeds `timeoutMs` (default 5000).
   */
  waitForReady(timeoutMs = 5000): Promise<SidecarEvent> {
    return new Promise((resolve, reject) => {
      const unsub = this.onEvent((e) => {
        if (e.type === 'ready') {
          unsub();
          clearTimeout(timer);
          resolve(e);
        }
      });
      const timer = setTimeout(() => {
        unsub();
        reject(new Error(`sidecar ready event not received within ${timeoutMs}ms`));
      }, timeoutMs);
    });
  }

  private onData(chunk: string): void {
    this.buf += chunk;
    let nl: number;
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      if (!line.trim()) continue;
      for (const l of this.rawLineListeners) l(line);
      let obj: unknown;
      try {
        obj = JSON.parse(line);
      } catch {
        // Skip malformed lines — defense in depth against any future stdout
        // leakage. Task 2.4 silenced whisper/ggml stdout; this catches anything
        // we missed.
        continue;
      }
      if (!obj || typeof obj !== 'object') continue;
      const id = (obj as { id?: unknown }).id;
      if (typeof id === 'string') {
        const p = this.pending.get(id);
        if (p) {
          this.pending.delete(id);
          if (p.timer) clearTimeout(p.timer);
          p.resolve(obj as SidecarResponse);
        }
      } else {
        for (const cb of this.eventListeners) cb(obj as SidecarEvent);
      }
    }
  }

  private rejectAllPending(err: Error): void {
    for (const [, p] of this.pending) {
      if (p.timer) clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }
}
