import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateModelFile, serializeWrite } from '../model-resolver';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lisna-model-resolver-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function writeFixture(name: string, bytes: number[]): Promise<string> {
  const p = path.join(tmpDir, name);
  await fs.writeFile(p, Buffer.from(bytes));
  return p;
}

describe('validateModelFile', () => {
  it('STT slot accepts GGML magic lmgg', async () => {
    const p = await writeFixture('whisper-lmgg.bin', [0x6c, 0x6d, 0x67, 0x67, 0x00, 0x00]);
    expect(await validateModelFile(p, 'stt')).toEqual({ ok: true });
  });

  it('STT slot accepts GGML magic tjgg (quantized variant)', async () => {
    const p = await writeFixture('whisper-tjgg.bin', [0x74, 0x6a, 0x67, 0x67, 0x00, 0x00]);
    expect(await validateModelFile(p, 'stt')).toEqual({ ok: true });
  });

  it('STT slot rejects GGUF magic with wrong-format', async () => {
    const p = await writeFixture('llama.gguf', [0x47, 0x47, 0x55, 0x46, 0x00, 0x00]);
    expect(await validateModelFile(p, 'stt')).toEqual({ ok: false, reason: 'wrong-format' });
  });

  it('STT slot rejects truncated file (<4 bytes) with unreadable', async () => {
    const p = await writeFixture('tiny.bin', [0x6c, 0x6d]);
    expect(await validateModelFile(p, 'stt')).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('STT slot rejects missing path with unreadable', async () => {
    const result = await validateModelFile(path.join(tmpDir, 'does-not-exist'), 'stt');
    expect(result).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('LLM slot accepts GGUF magic', async () => {
    const p = await writeFixture('llama.gguf', [0x47, 0x47, 0x55, 0x46, 0x00, 0x00]);
    expect(await validateModelFile(p, 'llm')).toEqual({ ok: true });
  });

  it('LLM slot rejects GGML magic with wrong-format', async () => {
    const p = await writeFixture('whisper.bin', [0x6c, 0x6d, 0x67, 0x67, 0x00, 0x00]);
    expect(await validateModelFile(p, 'llm')).toEqual({ ok: false, reason: 'wrong-format' });
  });

  // Spec §10.1 row 6 — EACCES (permission denied). Skip on root since chmod
  // 0o000 has no effect for root and the test would falsely pass.
  it('STT slot rejects permission-denied file with unreadable (EACCES)', async () => {
    if (process.getuid?.() === 0) return;  // root — skip
    const p = await writeFixture('locked.bin', [0x6c, 0x6d, 0x67, 0x67]);
    await fs.chmod(p, 0o000);
    try {
      expect(await validateModelFile(p, 'stt')).toEqual({ ok: false, reason: 'unreadable' });
    } finally {
      await fs.chmod(p, 0o600);  // restore so afterEach rm can clean up
    }
  });
});

describe('serializeWrite', () => {
  it('runs operations in order even when scheduled concurrently', async () => {
    const order: number[] = [];
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    const p1 = serializeWrite(async () => { await sleep(20); order.push(1); return 1; });
    const p2 = serializeWrite(async () => { await sleep(5); order.push(2); return 2; });
    const p3 = serializeWrite(async () => { order.push(3); return 3; });

    expect(await Promise.all([p1, p2, p3])).toEqual([1, 2, 3]);
    expect(order).toEqual([1, 2, 3]);
  });

  it('continues the chain after a rejected operation', async () => {
    const order: string[] = [];
    const p1 = serializeWrite(async () => { order.push('a'); throw new Error('boom'); });
    const p2 = serializeWrite(async () => { order.push('b'); return 'b'; });
    await expect(p1).rejects.toThrow('boom');
    await expect(p2).resolves.toBe('b');
    expect(order).toEqual(['a', 'b']);
  });
});
