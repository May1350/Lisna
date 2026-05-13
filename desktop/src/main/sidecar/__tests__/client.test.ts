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
    // We pass `type: 'ping'` even though it's not in the SidecarRequest union;
    // the protocol accepts ping in dispatch but isn't formally typed yet.
    const respPromise = client.send({ type: 'ping' } as never, { timeoutMs: 200 });
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

describe('SidecarClient send() timeout', () => {
  it('rejects with timeout error when no response arrives', async () => {
    // `sleep` does not echo stdin, so the response never comes.
    const proc = spawn('sleep', ['10'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const client = new SidecarClient(proc);
    await expect(client.send({ type: 'ping' } as never, { timeoutMs: 50 })).rejects.toThrow(
      /timed out/,
    );
    proc.kill('SIGKILL');
  });

  it('rejects all pending requests when child exits', async () => {
    const proc = spawn('sleep', ['10'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const client = new SidecarClient(proc);
    const sendPromise = client.send({ type: 'ping' } as never, { timeoutMs: 5000 });
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
        const resp = await client.send({ type: 'ping' } as never, { timeoutMs: 1000 });
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
          } as never,
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
