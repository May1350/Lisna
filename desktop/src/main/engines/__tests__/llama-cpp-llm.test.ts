/**
 * Unit + integration tests for LlamaCppLLM.
 *
 * - Unit tests drive a real `SidecarClient` against a fake `ChildProcess` —
 *   the adapter's outgoing JSON is captured on stdin, and the test pushes
 *   crafted JSON responses through stdout. `/bin/cat` is not usable here
 *   because it echoes the request as the "response" and the adapter's
 *   `send()` would match the echoed request line as its own reply.
 * - Integration test is ENV-gated by `LISNA_TEST_LLM_MODEL` and spawns the
 *   real sidecar binary at `desktop/resources/sidecar`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough, type Readable, Writable } from 'node:stream';
import { resolve as resolvePath } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { SidecarClient } from '../../sidecar/client';
import { LlamaCppLLM } from '../llama-cpp-llm';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Minimal `ChildProcess` stand-in: stdin captures requests written by the
 * client; stdout/stderr are `PassThrough` streams the test pushes data into;
 * the proc itself is an `EventEmitter` so `proc.on('exit', ...)` works.
 *
 * Why bother: `/bin/cat` echoes the request itself as the first stdout line,
 * which the client's `onData` matches as the pending response — turning every
 * `send()` into a "respond with the request you sent". For the streaming
 * `sendStream` path that's harmless (the echo has type !== token/done/error
 * so the stream listener ignores it), but for `send()`-based `loadModel` /
 * `unloadModel` the echo wins. A fake gives us a clean response channel.
 */
function makeFakeProc(): {
  proc: ChildProcess;
  requests: object[];
  writeLine: (line: string) => void;
  fireExit: () => void;
} {
  const ee = new EventEmitter() as unknown as ChildProcess;
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const requests: object[] = [];
  const stdin = new Writable({
    write(chunk: Buffer | string, _enc, cb) {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      // Lines arrive newline-terminated. Split and JSON.parse each one.
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
          requests.push(JSON.parse(line));
        } catch {
          /* ignore malformed */
        }
      }
      cb();
    },
  });
  // Re-cast the EventEmitter to ChildProcess with the stdio fields the
  // SidecarClient inspects (.stdout / .stderr / .stdin). The unused fields
  // stay undefined — the SidecarClient only ever touches these three plus
  // .on('exit').
  (ee as unknown as { stdout: Readable }).stdout = stdout;
  (ee as unknown as { stderr: Readable }).stderr = stderr;
  (ee as unknown as { stdin: Writable }).stdin = stdin;
  return {
    proc: ee,
    requests,
    writeLine: (line) => stdout.write(line + '\n'),
    fireExit: () => (ee as unknown as EventEmitter).emit('exit', 0, null),
  };
}

describe('LlamaCppLLM with fake ChildProcess', () => {
  let fake: ReturnType<typeof makeFakeProc>;
  let client: SidecarClient;
  let llm: LlamaCppLLM;
  beforeEach(() => {
    fake = makeFakeProc();
    client = new SidecarClient(fake.proc);
    llm = new LlamaCppLLM(client);
  });
  afterEach(() => {
    fake.fireExit();
  });

  // Pull the id of the most recently captured request of a given type, after
  // waiting a microtask so the synchronous write has been flushed.
  async function lastRequestId(type: string): Promise<string> {
    await new Promise((r) => setTimeout(r, 5));
    for (let i = fake.requests.length - 1; i >= 0; i--) {
      const req = fake.requests[i] as { id?: unknown; type?: unknown };
      if (req.type === type && typeof req.id === 'string') return req.id;
    }
    throw new Error(`no request of type ${type} captured (saw: ${JSON.stringify(fake.requests)})`);
  }

  it('loadModel sends load request and resolves on ok', async () => {
    const p = llm.loadModel('/tmp/m.gguf');
    const id = await lastRequestId('load');
    fake.writeLine(JSON.stringify({ id, type: 'ok' }));
    await expect(p).resolves.toBeUndefined();
    expect(fake.requests).toContainEqual(
      expect.objectContaining({ type: 'load', kind: 'llm', path: '/tmp/m.gguf', id }),
    );
  });

  it('loadModel throws with code+message on error response', async () => {
    const p = llm.loadModel('/tmp/m.gguf');
    const id = await lastRequestId('load');
    fake.writeLine(
      JSON.stringify({ id, type: 'error', code: 'ENOENT', message: 'missing model file' }),
    );
    await expect(p).rejects.toThrow(/LLM load failed \[ENOENT\]: missing model file/);
  });

  it('loadModel throws on unexpected response shape', async () => {
    const p = llm.loadModel('/tmp/m.gguf');
    const id = await lastRequestId('load');
    fake.writeLine(JSON.stringify({ id, type: 'segments', segments: [] }));
    await expect(p).rejects.toThrow(/LLM load: unexpected response/);
  });

  it('unloadModel sends unload request and resolves on ok', async () => {
    const p = llm.unloadModel();
    const id = await lastRequestId('unload');
    fake.writeLine(JSON.stringify({ id, type: 'ok' }));
    await expect(p).resolves.toBeUndefined();
    expect(fake.requests).toContainEqual(
      expect.objectContaining({ type: 'unload', kind: 'llm', id }),
    );
  });

  it('unloadModel throws with code+message on error', async () => {
    const p = llm.unloadModel();
    const id = await lastRequestId('unload');
    fake.writeLine(
      JSON.stringify({ id, type: 'error', code: 'ESTATE', message: 'no model loaded' }),
    );
    await expect(p).rejects.toThrow(/LLM unload failed \[ESTATE\]: no model loaded/);
  });

  it('generate aggregates tokens in order via the async iterable', async () => {
    const stream = llm.generate('hi', { maxTokens: 16 });
    const id = await lastRequestId('generate');
    fake.writeLine(JSON.stringify({ id, type: 'token', token: 'Hel' }));
    fake.writeLine(JSON.stringify({ id, type: 'token', token: 'lo' }));
    fake.writeLine(JSON.stringify({ id, type: 'token', token: '!' }));
    fake.writeLine(JSON.stringify({ id, type: 'done' }));
    let out = '';
    for await (const tok of stream) out += tok;
    expect(out).toBe('Hello!');
  });

  it('generate throws on error during stream', async () => {
    const stream = llm.generate('hi', {});
    const id = await lastRequestId('generate');
    fake.writeLine(JSON.stringify({ id, type: 'token', token: 'partial' }));
    fake.writeLine(JSON.stringify({ id, type: 'error', code: 'EOOM', message: 'out of memory' }));
    const consume = async (): Promise<string> => {
      let out = '';
      for await (const tok of stream) out += tok;
      return out;
    };
    await expect(consume()).rejects.toThrow(/EOOM.*out of memory/);
  });

  it('generate remaps SidecarClient "no progress" timeout to GENERATE_TIMEOUT', async () => {
    // SidecarClient.sendStream rejects with a "no progress" timeout error
    // when no token/done/error arrives within the configured window. The
    // adapter must remap that to the typed `GENERATE_TIMEOUT` so ErrorView's
    // friendly-map can show a meaningful message. Non-timeout errors stay
    // unchanged (covered by the previous 'error during stream' test).
    //
    // To force the timeout without actually sleeping 60s, we use vi.useFakeTimers
    // + advanceTimersByTimeAsync.
    const { vi } = await import('vitest');
    vi.useFakeTimers();
    try {
      const stream = llm.generate('hi', {});
      // Don't await — just begin consumption. The sendStream registered its
      // no-progress timer on entry. Advancing past the timeout window fires
      // the rejection.
      const consume = async (): Promise<string> => {
        let out = '';
        for await (const tok of stream) out += tok;
        return out;
      };
      const consumePromise = consume();
      const guarded = consumePromise.catch((e) => e);
      // Advance well past the GENERATE_NO_PROGRESS_MS budget (60s).
      await vi.advanceTimersByTimeAsync(70_000);
      const err = await guarded;
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe('GENERATE_TIMEOUT');
    } finally {
      vi.useRealTimers();
    }
  });

  it('generate preserves non-timeout error messages (does NOT remap to GENERATE_TIMEOUT)', async () => {
    // Sanity-check the remap is keyed on the "no progress" substring, not a
    // catch-all. A sidecar `error` response still produces the original
    // "[code]: message" string so logs stay diagnostic.
    const stream = llm.generate('hi', {});
    const id = await lastRequestId('generate');
    fake.writeLine(
      JSON.stringify({ id, type: 'error', code: 'EOOM', message: 'out of memory' }),
    );
    const consume = async (): Promise<string> => {
      let out = '';
      for await (const tok of stream) out += tok;
      return out;
    };
    await expect(consume()).rejects.toThrow(/EOOM.*out of memory/);
  });

  it('generate forwards prompt and opts (maxTokens/temperature/stop) into the request line', async () => {
    const stream = llm.generate('prompt-text', {
      maxTokens: 32,
      temperature: 0.7,
      stop: ['\n\n'],
    });
    const id = await lastRequestId('generate');
    fake.writeLine(JSON.stringify({ id, type: 'done' }));
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _tok of stream) { /* drain */ }
    expect(fake.requests).toContainEqual(
      expect.objectContaining({
        type: 'generate',
        prompt: 'prompt-text',
        maxTokens: 32,
        temperature: 0.7,
        stop: ['\n\n'],
        id,
      }),
    );
  });
});

// Integration: real sidecar binary + real LLM model.
// Resolves: src/main/engines/__tests__/<file> → desktop/resources/sidecar.
const sidecarPath = resolvePath(__dirname, '../../../../resources/sidecar');
const llmModel = process.env.LISNA_TEST_LLM_MODEL ?? '';
const describeIf = llmModel && existsSync(sidecarPath) ? describe : describe.skip;

describeIf('LlamaCppLLM (real model)', () => {
  it(
    'short prompt yields non-empty response',
    async () => {
      const proc = spawn(sidecarPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
      const client = new SidecarClient(proc);
      try {
        await client.waitForReady(5000);
        const llm = new LlamaCppLLM(client);
        await llm.loadModel(llmModel);
        let out = '';
        for await (const tok of llm.generate('1+1=', { maxTokens: 16, temperature: 0 })) {
          out += tok;
        }
        expect(out.length).toBeGreaterThan(0);
        await llm.unloadModel();
      } finally {
        proc.kill('SIGTERM');
      }
    },
    120_000,
  );
});
