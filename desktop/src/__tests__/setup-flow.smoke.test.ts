/**
 * Step 5 §5.1 — boot-time scenarios. Tests the resolveModels boot path
 * with real filesystem (tmpdir). Verifies that ModelStatus produced by
 * resolveModels matches what the App.tsx initial useEffect would see
 * via getModelStatus.
 *
 * Renderer-side flow (SetupView state transitions) is out of scope here
 * — that's covered by a component test (future task) or manual smoke
 * (Task 12). This file is the boot-orchestration smoke layer only.
 *
 * Spec: §10.3 (boot-time scenarios with mocked fs)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveModels, saveModelsJson } from '../main/model-resolver';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lisna-smoke-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

/**
 * Write an 8-byte fixture file with the appropriate magic bytes for the slot.
 * resolveModels only existence-checks (no magic-byte validation) — the magic
 * bytes are present here to match the real-world file shape, but any 8-byte
 * file would satisfy the existence check.
 */
async function writeRealModel(name: string, slot: 'stt' | 'llm'): Promise<string> {
  const magic = slot === 'stt' ? [0x6c, 0x6d, 0x67, 0x67] : [0x47, 0x47, 0x55, 0x46];
  const p = path.join(dir, name);
  await fs.writeFile(p, Buffer.from([...magic, 0, 0, 0, 0]));
  return p;
}

describe('setup-flow smoke (boot scenarios)', () => {
  it('1. empty userData → needs-setup with both slots missing', async () => {
    const r = await resolveModels({ userDataDir: dir, envOverride: {} });
    expect(r).toEqual({ kind: 'needs-setup', missing: ['stt', 'llm'] });
  });

  it('2. valid models.json + both files exist → ready', async () => {
    const stt = await writeRealModel('w.bin', 'stt');
    const llm = await writeRealModel('l.gguf', 'llm');
    await saveModelsJson(dir, { version: 1, sttPath: stt, llmPath: llm });
    expect(await resolveModels({ userDataDir: dir, envOverride: {} }))
      .toEqual({ kind: 'ready', sttPath: stt, llmPath: llm });
  });

  it('3. stale models.json (LLM file deleted) → needs-setup [llm]', async () => {
    const stt = await writeRealModel('w.bin', 'stt');
    await saveModelsJson(dir, {
      version: 1,
      sttPath: stt,
      llmPath: path.join(dir, 'deleted.gguf'),
    });
    expect(await resolveModels({ userDataDir: dir, envOverride: {} }))
      .toEqual({ kind: 'needs-setup', missing: ['llm'] });
  });

  it('4. env-var override active → ready (env paths)', async () => {
    const stt = await writeRealModel('env-w.bin', 'stt');
    const llm = await writeRealModel('env-l.gguf', 'llm');
    expect(await resolveModels({
      userDataDir: dir,
      envOverride: { stt, llm },
    })).toEqual({ kind: 'ready', sttPath: stt, llmPath: llm });
  });

  it('5. env-var set BUT env file missing → needs-setup; no fallback to models.json', async () => {
    const realStt = await writeRealModel('real-w.bin', 'stt');
    const realLlm = await writeRealModel('real-l.gguf', 'llm');
    // models.json points to real files
    await saveModelsJson(dir, { version: 1, sttPath: realStt, llmPath: realLlm });
    // But env override points to a non-existent file for STT
    const r = await resolveModels({
      userDataDir: dir,
      envOverride: { stt: path.join(dir, 'nope.bin'), llm: realLlm },
    });
    // Env wins authoritatively; STT missing because env path doesn't exist.
    // Does NOT fall back to models.json's sttPath.
    expect(r).toEqual({ kind: 'needs-setup', missing: ['stt'] });
  });

  it('6. models.json.tmp orphan + valid models.json → tmp deleted on entry, valid result', async () => {
    const stt = await writeRealModel('w.bin', 'stt');
    const llm = await writeRealModel('l.gguf', 'llm');
    await saveModelsJson(dir, { version: 1, sttPath: stt, llmPath: llm });
    // Simulate a crash-leftover .tmp file
    await fs.writeFile(path.join(dir, 'models.json.tmp'), 'orphan');
    const r = await resolveModels({ userDataDir: dir, envOverride: {} });
    expect(r).toEqual({ kind: 'ready', sttPath: stt, llmPath: llm });
    // And the orphan is gone
    await expect(fs.stat(path.join(dir, 'models.json.tmp'))).rejects.toThrow();
  });

  // --- Reviewer carryforwards (beyond plan's original 6) ---

  it('7. empty-string env path is falsy → falls through to stored path → ready', async () => {
    // Pins the lower-level contract: resolveModels does NOT silently
    // normalize '' to undefined — but '' is falsy, so the `if (envPath)`
    // guard in resolveSlot treats it as unset and falls through to the
    // stored path. This is DIFFERENT from a truthy non-existent path (scenario 5),
    // which would be authoritative and return needs-setup.
    //
    // The main/index.ts boundary uses `?.trim() || undefined` to coerce
    // empty env vars to undefined BEFORE calling resolveModels — that
    // normalization is verified by manual smoke in Task 12. Here we pin
    // the direct resolveModels behavior: '' is falsy → stored path is used.
    //
    // Note: both stored paths point to realLlm (a GGUF file with GGUF magic
    // used as the stored sttPath). resolveModels only existence-checks, not
    // magic-byte-validates, so this resolves to ready.
    const realLlm = await writeRealModel('real-l.gguf', 'llm');
    await saveModelsJson(dir, { version: 1, sttPath: realLlm, llmPath: realLlm });
    const r = await resolveModels({
      userDataDir: dir,
      envOverride: { stt: '', llm: realLlm },
    });
    // STT env is '' (falsy) → resolveSlot falls through to stored sttPath (realLlm).
    // LLM env is realLlm (truthy, exists) → resolves directly.
    // Both ok → ready.
    expect(r).toEqual({ kind: 'ready', sttPath: realLlm, llmPath: realLlm });
  });

  it('8. malformed models.json → loadModelsJson returns null → needs-setup both', async () => {
    // Pins the corrupt-file recovery path (M-4 carryforward from Task 7
    // reviewer). loadModelsJson catches JSON.parse errors and returns
    // null; resolveModels with no stored paths and no env override
    // yields needs-setup with both slots.
    await fs.writeFile(path.join(dir, 'models.json'), '{ broken json');
    const r = await resolveModels({ userDataDir: dir, envOverride: {} });
    expect(r).toEqual({ kind: 'needs-setup', missing: ['stt', 'llm'] });
  });
});
