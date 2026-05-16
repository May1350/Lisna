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

import { loadModelsJson, saveModelsJson, type ModelsJson } from '../model-resolver';

describe('loadModelsJson', () => {
  it('returns null when models.json does not exist', async () => {
    expect(await loadModelsJson(tmpDir)).toBeNull();
  });

  it('returns parsed v1 content when file is valid', async () => {
    const content: ModelsJson = { version: 1, sttPath: '/abs/whisper.bin', llmPath: '/abs/llama.gguf' };
    await fs.writeFile(path.join(tmpDir, 'models.json'), JSON.stringify(content));
    expect(await loadModelsJson(tmpDir)).toEqual(content);
  });

  it('returns null on malformed JSON', async () => {
    await fs.writeFile(path.join(tmpDir, 'models.json'), '{ not valid');
    expect(await loadModelsJson(tmpDir)).toBeNull();
  });

  it('returns null on version mismatch (e.g. version: 2)', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'models.json'),
      JSON.stringify({ version: 2, sttPath: '/a', llmPath: '/b' }),
    );
    expect(await loadModelsJson(tmpDir)).toBeNull();
  });

  it('returns null when sttPath or llmPath is not a string', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'models.json'),
      JSON.stringify({ version: 1, sttPath: 123, llmPath: null }),
    );
    expect(await loadModelsJson(tmpDir)).toBeNull();
  });

  it('deletes orphan models.json.tmp on entry (crash recovery)', async () => {
    await fs.writeFile(path.join(tmpDir, 'models.json.tmp'), 'orphan content');
    await loadModelsJson(tmpDir);
    await expect(fs.stat(path.join(tmpDir, 'models.json.tmp'))).rejects.toThrow();
  });

  it('orphan-tmp deletion is idempotent — no error when tmp does not exist', async () => {
    // No tmp file present; should not throw.
    await expect(loadModelsJson(tmpDir)).resolves.toBeNull();
  });
});

describe('saveModelsJson', () => {
  it('writes models.json atomically and cleans up tmp', async () => {
    const content: ModelsJson = { version: 1, sttPath: '/abs/a.bin', llmPath: '/abs/b.gguf' };
    await saveModelsJson(tmpDir, content);
    const final = path.join(tmpDir, 'models.json');
    const tmp = path.join(tmpDir, 'models.json.tmp');
    const written = JSON.parse(await fs.readFile(final, 'utf8'));
    expect(written).toEqual(content);
    await expect(fs.stat(tmp)).rejects.toThrow();  // tmp gone after rename
  });

  it('survives a sequence of writes (serialized, last-writer-wins)', async () => {
    const a: ModelsJson = { version: 1, sttPath: '/a', llmPath: '/x' };
    const b: ModelsJson = { version: 1, sttPath: '/b', llmPath: '/y' };
    await Promise.all([saveModelsJson(tmpDir, a), saveModelsJson(tmpDir, b)]);
    const final = JSON.parse(await fs.readFile(path.join(tmpDir, 'models.json'), 'utf8'));
    expect(final).toEqual(b);  // last queued wins
  });

  it('directory fsync does not throw on macOS APFS (smoke)', async () => {
    // Pinning that fs.promises.open(dir, 'r') + FileHandle.sync() works
    // on the test runner's filesystem. If this fails on a future Node
    // version, replace the dir fsync with child_process.spawn('sync').
    await expect(
      saveModelsJson(tmpDir, { version: 1, sttPath: '/a', llmPath: '/b' }),
    ).resolves.toBeUndefined();
  });

  // NOTE: spec §10.1 row 18 (fsync rejection → no rename → models.json absent)
  // lives in model-resolver-fsync-failure.test.ts — that case requires
  // vi.mock('node:fs') hoisting, which can't share a file with the
  // real-fs tests above (Node 25 ESM namespaces are non-configurable, so
  // vi.spyOn fails; vi.mock must be hoisted before any module evaluation).
});
