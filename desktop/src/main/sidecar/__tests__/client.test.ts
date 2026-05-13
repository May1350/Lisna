import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve as resolvePath } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { SidecarClient } from '../client';

const __dirname = dirname(fileURLToPath(import.meta.url));

// `/bin/cat` echoes stdin → stdout line-by-line. Perfect harness for testing
// the buffer/parse logic without needing the real sidecar binary.
describe('SidecarClient with /bin/cat (raw line buffering)', () => {
  let proc: ChildProcess;
  beforeEach(() => {
    proc = spawn('cat', [], { stdio: ['pipe', 'pipe', 'pipe'] });
  });
  afterEach(() => {
    proc.kill('SIGKILL');
  });

  it('echoed lines surface in onRawLine', async () => {
    const client = new SidecarClient(proc);
    const seen: string[] = [];
    client.onRawLine((l) => seen.push(l));
    proc.stdin!.write('{"id":"1","type":"ping"}\n');
    await new Promise((r) => setTimeout(r, 100));
    expect(seen.length).toBeGreaterThanOrEqual(1);
    expect(seen[0]).toContain('"id":"1"');
  });

  it('buffers partial lines across chunks', async () => {
    const client = new SidecarClient(proc);
    const seen: string[] = [];
    client.onRawLine((l) => seen.push(l));
    proc.stdin!.write('{"id":"a","ty');
    await new Promise((r) => setTimeout(r, 20));
    proc.stdin!.write('pe":"ping"}\n');
    await new Promise((r) => setTimeout(r, 80));
    expect(seen.length).toBeGreaterThanOrEqual(1);
    expect(seen[0]).toBe('{"id":"a","type":"ping"}');
  });

  it('malformed lines do not break parsing or pending requests', async () => {
    const client = new SidecarClient(proc);
    proc.stdin!.write('not json\n');
    // valid response shape but with no matching pending → ignored cleanly
    proc.stdin!.write('{"id":"x","type":"ok"}\n');
    await new Promise((r) => setTimeout(r, 30));

    // Now exercise a real round-trip: cat echoes our line back with the same
    // id, the client matches it, the promise resolves with the echoed body.
    const respPromise = client.send({ type: 'ping' }, { timeoutMs: 200 });
    await expect(respPromise).resolves.toMatchObject({ type: 'ping' });
  });

  it('id-less lines route to event listeners, not pending requests', async () => {
    const client = new SidecarClient(proc);
    const events: unknown[] = [];
    client.onEvent((e) => events.push(e));
    proc.stdin!.write('{"type":"ready","pid":42,"version":"0.0.1"}\n');
    await new Promise((r) => setTimeout(r, 50));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'ready', pid: 42 });
  });
});

// Helper: drive `sendStream` against /bin/cat by capturing the id from the
// echoed request line and writing fake token/done/error lines back through
// stdin. Subscribes BEFORE the caller invokes sendStream (since `sendStream`
// now writes the request synchronously, the echo can arrive before any
// post-call subscriber attaches).
function preparePump(
  proc: ChildProcess,
  client: SidecarClient,
): { feed: (lines: (id: string) => string[]) => Promise<string> } {
  let resolveId: (id: string) => void;
  const idPromise = new Promise<string>((r) => (resolveId = r));
  const unsub = client.onRawLine((l) => {
    try {
      const obj = JSON.parse(l) as { id?: string; type?: string };
      // The echoed request line carries our id and is the only one with
      // `type === 'generate'` (cat echoes the request the sidecar would
      // normally consume).
      if (obj.type === 'generate' && typeof obj.id === 'string') {
        unsub();
        resolveId(obj.id);
      }
    } catch {
      /* ignore */
    }
  });
  return {
    feed: async (lines) => {
      const id = await idPromise;
      for (const l of lines(id)) proc.stdin!.write(l + '\n');
      return id;
    },
  };
}

describe('SidecarClient.sendStream with /bin/cat', () => {
  let proc: ChildProcess;
  beforeEach(() => {
    proc = spawn('cat', [], { stdio: ['pipe', 'pipe', 'pipe'] });
  });
  afterEach(() => {
    proc.kill('SIGKILL');
  });

  it('yields tokens in order and terminates cleanly on done', async () => {
    const client = new SidecarClient(proc);
    const pump = preparePump(proc, client);
    const stream = client.sendStream(
      { type: 'generate', prompt: 'hi', maxTokens: 4 },
      { timeoutMs: 2000 },
    );
    await pump.feed((id) => [
      JSON.stringify({ id, type: 'token', token: 'A' }),
      JSON.stringify({ id, type: 'token', token: 'B' }),
      JSON.stringify({ id, type: 'token', token: 'C' }),
      JSON.stringify({ id, type: 'done' }),
    ]);
    const out: string[] = [];
    for await (const tok of stream) out.push(tok);
    expect(out).toEqual(['A', 'B', 'C']);
  });

  it('throws on error response with code+message in the thrown error', async () => {
    const client = new SidecarClient(proc);
    const pump = preparePump(proc, client);
    const stream = client.sendStream(
      { type: 'generate', prompt: 'x' },
      { timeoutMs: 2000 },
    );
    await pump.feed((id) => [
      JSON.stringify({ id, type: 'token', token: 'partial' }),
      JSON.stringify({ id, type: 'error', code: 'EBOOM', message: 'kaboom' }),
    ]);
    const iter = stream[Symbol.asyncIterator]();
    const first = await iter.next();
    expect(first.value).toBe('partial');
    // Combined assertion: the thrown error includes both code and message.
    await expect(iter.next()).rejects.toThrow(/EBOOM.*kaboom/);
  });

  it('throws when the child process exits mid-stream', async () => {
    const client = new SidecarClient(proc);
    const stream = client.sendStream(
      { type: 'generate', prompt: 'x' },
      { timeoutMs: 5000 },
    );
    // Kill cat AFTER it has echoed the request — give a tick so the request
    // round-trips into the client's onData buffer first.
    setTimeout(() => proc.kill('SIGKILL'), 30);
    const consume = async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _tok of stream) { /* drain */ }
    };
    await expect(consume()).rejects.toThrow(/sidecar process exited/);
  });

  it('rejects when no progress within the timeout window', async () => {
    const client = new SidecarClient(proc);
    const stream = client.sendStream(
      { type: 'generate', prompt: 'x' },
      { timeoutMs: 50 },
    );
    const consume = async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _tok of stream) { /* drain */ }
    };
    await expect(consume()).rejects.toThrow(/timed out/);
  });

  it('progress-based timeout: resets on each token, terminates only after silence > timeoutMs', async () => {
    const client = new SidecarClient(proc);
    const pump = preparePump(proc, client);
    const stream = client.sendStream(
      { type: 'generate', prompt: 'x' },
      { timeoutMs: 80 },
    );
    // Drip-feed tokens every 40ms (under 80ms budget). Total ~160ms — longer
    // than the timeout, but no individual gap exceeds it.
    const drip = async () => {
      const id = await pump.feed(() => []);
      for (let i = 0; i < 4; i++) {
        await new Promise((r) => setTimeout(r, 40));
        proc.stdin!.write(JSON.stringify({ id, type: 'token', token: `t${i}` }) + '\n');
      }
      await new Promise((r) => setTimeout(r, 40));
      proc.stdin!.write(JSON.stringify({ id, type: 'done' }) + '\n');
    };
    void drip();
    const out: string[] = [];
    for await (const tok of stream) out.push(tok);
    expect(out).toEqual(['t0', 't1', 't2', 't3']);
  });

  it('Infinity timeout opts out of the no-progress watchdog', async () => {
    const client = new SidecarClient(proc);
    const pump = preparePump(proc, client);
    const stream = client.sendStream(
      { type: 'generate', prompt: 'x' },
      { timeoutMs: Infinity },
    );
    setTimeout(() => {
      void pump.feed((id) => [
        JSON.stringify({ id, type: 'token', token: 'late' }),
        JSON.stringify({ id, type: 'done' }),
      ]);
    }, 80);
    const out: string[] = [];
    for await (const tok of stream) out.push(tok);
    expect(out).toEqual(['late']);
  });

  it('handles tokens that arrive BEFORE consumer pulls (no missed signal)', async () => {
    const client = new SidecarClient(proc);
    const pump = preparePump(proc, client);
    const stream = client.sendStream(
      { type: 'generate', prompt: 'x' },
      { timeoutMs: 2000 },
    );
    // Push two tokens + done synchronously, then sleep long enough for cat
    // to echo them all before we start the for-await loop. The naive
    // "rotate-waiter" pattern would lose the second signal here.
    await pump.feed((id) => [
      JSON.stringify({ id, type: 'token', token: 'one' }),
      JSON.stringify({ id, type: 'token', token: 'two' }),
      JSON.stringify({ id, type: 'done' }),
    ]);
    await new Promise((r) => setTimeout(r, 50));
    const out: string[] = [];
    for await (const tok of stream) out.push(tok);
    expect(out).toEqual(['one', 'two']);
  });

  it('does NOT leak stream lines into onEvent subscribers', async () => {
    const client = new SidecarClient(proc);
    const events: unknown[] = [];
    client.onEvent((e) => events.push(e));
    const pump = preparePump(proc, client);
    const stream = client.sendStream(
      { type: 'generate', prompt: 'x' },
      { timeoutMs: 2000 },
    );
    await pump.feed((id) => [
      JSON.stringify({ id, type: 'token', token: 'a' }),
      JSON.stringify({ id, type: 'done' }),
    ]);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _tok of stream) { /* drain */ }
    // Echoed request line has id but type=generate, no matching pending —
    // before the streamingIds fix it would have leaked to event listeners.
    expect(events).toHaveLength(0);
  });

  it('cleans up subscription after generator completes (no leak)', async () => {
    const client = new SidecarClient(proc);
    const before = countRawLineListeners(client);
    const pump = preparePump(proc, client);
    const stream = client.sendStream(
      { type: 'generate', prompt: 'x' },
      { timeoutMs: 2000 },
    );
    await pump.feed((id) => [
      JSON.stringify({ id, type: 'token', token: 'a' }),
      JSON.stringify({ id, type: 'done' }),
    ]);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _tok of stream) { /* drain */ }
    const after = countRawLineListeners(client);
    expect(after).toBe(before);
  });

  it('cleans up subscription on early break', async () => {
    const client = new SidecarClient(proc);
    const before = countRawLineListeners(client);
    const pump = preparePump(proc, client);
    const stream = client.sendStream(
      { type: 'generate', prompt: 'x' },
      { timeoutMs: 2000 },
    );
    await pump.feed((id) => [
      JSON.stringify({ id, type: 'token', token: 'a' }),
      JSON.stringify({ id, type: 'token', token: 'b' }),
      JSON.stringify({ id, type: 'done' }),
    ]);
    for await (const _tok of stream) {
      void _tok;
      break; // bail after the first token — finally must still run
    }
    // Give the buffered tokens a tick to land + finally to run.
    await new Promise((r) => setTimeout(r, 30));
    const after = countRawLineListeners(client);
    expect(after).toBe(before);
  });
});

// Test-only introspection: read the private `rawLineListeners` array to
// confirm `sendStream` doesn't leak its subscription. Exposing a public
// `listenerCount`-style API would only exist for tests; reaching in via a
// targeted cast keeps the production surface clean.
function countRawLineListeners(client: SidecarClient): number {
  const internal = client as unknown as { rawLineListeners: unknown[] };
  return internal.rawLineListeners.length;
}

describe('SidecarClient send() timeout', () => {
  it('rejects with timeout error when no response arrives', async () => {
    // `sleep` does not echo stdin, so the response never comes.
    const proc = spawn('sleep', ['10'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const client = new SidecarClient(proc);
    await expect(client.send({ type: 'ping' }, { timeoutMs: 50 })).rejects.toThrow(/timed out/);
    proc.kill('SIGKILL');
  });

  it('rejects all pending requests when child exits', async () => {
    const proc = spawn('sleep', ['10'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const client = new SidecarClient(proc);
    const sendPromise = client.send({ type: 'ping' }, { timeoutMs: 5000 });
    // Kill while the request is in flight.
    setTimeout(() => proc.kill('SIGKILL'), 20);
    await expect(sendPromise).rejects.toThrow(/sidecar process exited/);
  });
});

describe('SidecarClient waitForReady() timeout', () => {
  it('rejects when no ready event arrives within the budget', async () => {
    // `sleep` never emits anything, so `ready` will never come.
    const proc = spawn('sleep', ['10'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const client = new SidecarClient(proc);
    await expect(client.waitForReady(50)).rejects.toThrow(/ready event not received/);
    proc.kill('SIGKILL');
  });
});

// Real-binary tests assume `desktop/resources/sidecar` was built by Task 2.1+.
// Resolves: src/main/sidecar/__tests__/<file> → desktop/resources/sidecar.
const sidecarPath = resolvePath(__dirname, '../../../../resources/sidecar');

describe.skipIf(!existsSync(sidecarPath))(
  'SidecarClient against the real sidecar binary',
  () => {
    it('emits ready event, then ping → ok with id match', async () => {
      const proc = spawn(sidecarPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
      const client = new SidecarClient(proc);
      try {
        const ready = await client.waitForReady(2000);
        expect(ready.type).toBe('ready');
        const resp = await client.send({ type: 'ping' }, { timeoutMs: 1000 });
        expect(resp.type).toBe('ok');
      } finally {
        proc.kill('SIGTERM');
      }
    });

    it('routes whisper-source log events to event listeners (not pending)', async () => {
      const proc = spawn(sidecarPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
      const client = new SidecarClient(proc);
      try {
        await client.waitForReady(2000);
        const events: { type: string; source?: string }[] = [];
        client.onEvent((e) => events.push(e as { type: string; source?: string }));
        // Trigger a load that will fail → whisper emits log events before the
        // error response. Post Task 2.4 these arrive as JSON `log` events on
        // stdout (not raw text).
        const resp = await client.send(
          {
            type: 'load',
            kind: 'stt',
            path: '/tmp/lisna-nonexistent-model.gguf',
            language: 'ja',
          },
          { timeoutMs: 5000 },
        );
        expect(resp.type).toBe('error');
        const logEvents = events.filter((e) => e.type === 'log');
        expect(logEvents.length).toBeGreaterThan(0);
        // At least one of them should be whisper-sourced (vs ggml, etc.).
        const sources = new Set(logEvents.map((e) => e.source));
        expect(sources.has('whisper')).toBe(true);
      } finally {
        proc.kill('SIGTERM');
      }
    });
  },
);
