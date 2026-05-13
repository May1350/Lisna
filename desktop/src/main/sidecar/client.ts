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
  /**
   * Ids of in-flight `sendStream` calls. `onData` consults this so id-bearing
   * lines belonging to a stream (token/done/error) are NOT misrouted to event
   * listeners when no `pending` entry exists. Without this set, the fallback
   * `for (const cb of this.eventListeners) cb(...)` would treat every stream
   * line as an event.
   */
  private streamingIds = new Set<string>();

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
   * Streaming variant of `send()` for sidecar ops whose response is a sequence
   * of `{type:"token"}` lines terminated by `{type:"done"}` (or `{type:"error"}`).
   *
   * Yields tokens in arrival order. Returns when `done` lands. Throws if an
   * `error` lands, the sidecar exits, or no progress is observed within
   * `timeoutMs`. The timeout is **progress-based**: the timer resets on every
   * matching token/done/error so a long-but-steadily-producing stream is not
   * killed by a session-wide budget. Pass `Infinity` to opt out.
   *
   * Side effects (subscription, request write, timer arm) run synchronously at
   * call time — NOT lazily on first `next()` — so callers can subscribe to
   * pre-token output (e.g. the echoed request, in tests) before consuming.
   * Cleanup runs in the inner generator's `finally`, covering normal drain,
   * early `break`, and thrown error paths alike.
   *
   * Multiple concurrent calls on the same client are safe: each gets a fresh
   * UUID and isolated queue/listener/timer state.
   */
  sendStream(req: SidecarSendRequest, opts: SendOptions = {}): AsyncIterable<string> {
    const id = randomUUID();
    const timeoutMs = opts.timeoutMs ?? 5000;
    const queue: string[] = [];
    let done = false;
    let streamError: Error | null = null;
    // Edge-triggered wakeup with a sticky pending-signal flag. Naively
    // rotating the waiter on every signal (the obvious pattern) loses
    // signals that fire before the consumer reaches `await`: the resolver
    // for the OLD waiter fires harmlessly, the consumer then awaits the NEW
    // waiter and gets stuck. Tracking `pendingSignal` as a boolean fixes
    // this — when the consumer is about to wait, it consumes the flag
    // instead of awaiting if a signal already arrived.
    let pendingSignal = false;
    let wakeWaiter: (() => void) | null = null;
    const signal = (): void => {
      pendingSignal = true;
      const w = wakeWaiter;
      wakeWaiter = null;
      if (w) w();
    };
    const waitForSignal = (): Promise<void> => {
      if (pendingSignal) {
        pendingSignal = false;
        return Promise.resolve();
      }
      return new Promise<void>((r) => {
        wakeWaiter = r;
      });
    };

    let timer: NodeJS.Timeout | null = null;
    const armTimer = (): void => {
      if (timeoutMs === Infinity) return;
      timer = setTimeout(() => {
        streamError = new Error(`sidecar stream ${id} timed out after ${timeoutMs}ms (no progress)`);
        signal();
      }, timeoutMs);
    };
    const resetTimer = (): void => {
      if (timer) clearTimeout(timer);
      armTimer();
    };

    const unsubscribe = this.onRawLine((line) => {
      // Fast-path: only parse lines that could plausibly carry our id. Stream
      // lines always start with `{"id":` per the sidecar contract.
      if (!line.includes(`"${id}"`)) return;
      let obj: { id?: unknown; type?: unknown; token?: unknown; code?: unknown; message?: unknown };
      try {
        obj = JSON.parse(line);
      } catch {
        return;
      }
      if (obj.id !== id) return;
      if (obj.type === 'token' && typeof obj.token === 'string') {
        queue.push(obj.token);
        resetTimer();
        signal();
      } else if (obj.type === 'done') {
        done = true;
        resetTimer();
        signal();
      } else if (obj.type === 'error') {
        const code = typeof obj.code === 'string' ? obj.code : 'unknown';
        const message = typeof obj.message === 'string' ? obj.message : '(no message)';
        streamError = new Error(`sidecar stream ${id} failed [${code}]: ${message}`);
        resetTimer();
        signal();
      }
    });

    const onExit = (): void => {
      if (!done && !streamError) streamError = new Error('sidecar process exited');
      signal();
    };
    this.proc.once('exit', onExit);

    this.streamingIds.add(id);
    armTimer();
    this.proc.stdin!.write(JSON.stringify({ id, ...req }) + '\n');

    const cleanup = (): void => {
      unsubscribe();
      this.proc.off('exit', onExit);
      if (timer) clearTimeout(timer);
      this.streamingIds.delete(id);
    };

    async function* drain(): AsyncGenerator<string> {
      try {
        // Loop invariant: yield everything queued FIRST, then check terminal
        // state. This avoids dropping a final token that landed in the same
        // event-loop tick as `done`/`error`.
        while (true) {
          while (queue.length > 0) {
            // queue.shift() returns string|undefined under noUncheckedIndexedAccess
            // — we just checked length > 0 so it's safe.
            yield queue.shift() as string;
          }
          if (streamError) throw streamError;
          if (done) return;
          await waitForSignal();
        }
      } finally {
        cleanup();
      }
    }

    return drain();
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
      // Streaming ids own their lines entirely: the `sendStream` consumer
      // already handled this line via its `onRawLine` subscriber above. Bail
      // before pending lookup / event dispatch. Today this is defense in
      // depth — the `if/else` below already keeps id-bearing lines out of
      // event listeners — but it cements the invariant locally so a future
      // refactor restructuring the branching can't silently leak stream
      // token/done/error lines to `onEvent` subscribers.
      if (typeof id === 'string' && this.streamingIds.has(id)) continue;
      if (typeof id === 'string') {
        const p = this.pending.get(id);
        if (p) {
          this.pending.delete(id);
          if (p.timer) clearTimeout(p.timer);
          p.resolve(obj as SidecarResponse);
        }
        // If `id` belongs to an active stream, do NOT fall to event listeners;
        // the stream's `onRawLine` subscriber consumes it. The fallback is
        // reserved for unsolicited id-less lines (ready/log/memory).
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
