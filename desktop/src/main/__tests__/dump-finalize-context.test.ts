/**
 * buildDumpSessionContext — fully injected (no Electron). Covers review
 * defects: SESSION_ACTIVE guard, lazy sidecar respawn, language gate, and
 * P0-1 (NO dump dir is created by a from-dump run — fs dir count unchanged).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildDumpSessionContext, type DumpFinalizeDeps } from '../dump-finalize-context';
import type { GrammarCapableSidecar } from '../sidecar/grammar-call';

const ID = '2026-06-10T01-00-00-000Z';
let base: string;

const SIDECAR: GrammarCapableSidecar = {
  generateWithGrammar: vi.fn(),
};

function writeDump(language = 'ja'): void {
  const dir = path.join(base, ID);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'transcript.json'),
    JSON.stringify({
      sessionId: 'live',
      language,
      llmModel: 'whatever.gguf',
      segments: [{ startSec: 0, endSec: 2, text: 'こんにちは' }],
    }),
  );
}

function makeDeps(over: Partial<DumpFinalizeDeps<string>> = {}): DumpFinalizeDeps<string> {
  return {
    baseDir: base,
    getClient: () => 'client',
    startClient: vi.fn(async () => 'fresh-client'),
    getModelPaths: () => ({ sttPath: '/m/stt.bin', llmPath: '/m/Llama-3.2-3B-Instruct-Q4_K_M.gguf' }),
    loadLlm: vi.fn(async () => {}),
    makeSidecar: () => SIDECAR,
    ...over,
  };
}

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'dump-ctx-'));
});
afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

describe('buildDumpSessionContext', () => {
  it('builds a SessionContext from the dump with the CURRENT llm path and writes NO new dump dir', async () => {
    writeDump();
    const before = fs.readdirSync(base).length;
    const deps = makeDeps();
    const ctx = await buildDumpSessionContext(ID, deps);
    expect(ctx.sessionId).toBe(`dump:${ID}`);
    expect(ctx.segments).toHaveLength(1);
    expect(ctx.language).toBe('ja');
    expect(ctx.llmModelPath).toBe('/m/Llama-3.2-3B-Instruct-Q4_K_M.gguf');
    expect(ctx.sidecar).toBe(SIDECAR); // raw sidecar — NOT dump-wrapped (P0-1)
    expect(deps.loadLlm).toHaveBeenCalledWith('client', '/m/Llama-3.2-3B-Instruct-Q4_K_M.gguf');
    expect(fs.readdirSync(base).length).toBe(before); // P0-1: no dir created
  });

  // (Removed at Task 5: the SESSION_ACTIVE-while-live-session guard. Re-entrancy
  // is now gated by beginGeneration → genInFlight in ipc.ts before this runs, and
  // a live capture must NOT block a History regen — see the ipc.ts integration
  // test "a History regen runs while a capture is live".)

  it('lazily respawns the sidecar when idle-stopped', async () => {
    writeDump();
    const deps = makeDeps({ getClient: () => null });
    await buildDumpSessionContext(ID, deps);
    expect(deps.startClient).toHaveBeenCalledOnce();
    expect(deps.loadLlm).toHaveBeenCalledWith('fresh-client', expect.any(String));
  });

  it('maps a respawn failure to SIDECAR_DOWN', async () => {
    writeDump();
    await expect(
      buildDumpSessionContext(ID, makeDeps({
        getClient: () => null,
        startClient: vi.fn(async () => { throw new Error('spawn fail'); }),
      })),
    ).rejects.toThrow('SIDECAR_DOWN');
  });

  it('rejects MODELS_NOT_CONFIGURED and unsupported dump language', async () => {
    writeDump('ko');
    await expect(buildDumpSessionContext(ID, makeDeps())).rejects.toThrow('UNSUPPORTED_LANGUAGE');
    writeDump('ja');
    await expect(
      buildDumpSessionContext(ID, makeDeps({ getModelPaths: () => null })),
    ).rejects.toThrow('MODELS_NOT_CONFIGURED');
  });
});
