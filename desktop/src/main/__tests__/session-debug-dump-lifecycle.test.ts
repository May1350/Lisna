/**
 * Lifecycle + robustness tests for createSessionDump: opt-out env, dir
 * collision, retention pruning, best-effort writes. Core dump-content
 * behavior lives in session-debug-dump.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSessionDump } from '../session-debug-dump';
import type { GrammarCapableSidecar } from '../sidecar/grammar-call';

let baseDir: string;

beforeEach(() => {
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lisna-dump-'));
});

afterEach(() => {
  fs.rmSync(baseDir, { recursive: true, force: true });
  delete process.env.LISNA_DISABLE_SESSION_DUMP;
});

describe('createSessionDump lifecycle', () => {
  it('returns null when LISNA_DISABLE_SESSION_DUMP=1 and writes nothing', () => {
    process.env.LISNA_DISABLE_SESSION_DUMP = '1';
    const dump = createSessionDump({ baseDir });
    expect(dump).toBeNull();
    expect(fs.readdirSync(baseDir)).toEqual([]);
  });

  it('two dumps created at the same instant get distinct directories', () => {
    const fixed = new Date('2026-06-11T03:00:00.000Z');
    const a = createSessionDump({ baseDir, now: () => fixed });
    const b = createSessionDump({ baseDir, now: () => fixed });
    expect(a!.dir).not.toBe(b!.dir);
    expect(fs.statSync(b!.dir).isDirectory()).toBe(true);
  });

  it('prunes oldest dump dirs beyond maxSessions, leaving foreign dirs alone', () => {
    const foreign = path.join(baseDir, 'not-a-dump');
    fs.mkdirSync(foreign);
    const t0 = new Date('2026-06-11T03:00:00.000Z').getTime();
    const dirs: string[] = [];
    for (let i = 0; i < 4; i++) {
      const d = createSessionDump({ baseDir, maxSessions: 3, now: () => new Date(t0 + i * 60_000) })!;
      dirs.push(d.dir);
    }
    expect(fs.existsSync(dirs[0]!)).toBe(false); // oldest pruned
    expect(fs.existsSync(dirs[1]!)).toBe(true);
    expect(fs.existsSync(dirs[2]!)).toBe(true);
    expect(fs.existsSync(dirs[3]!)).toBe(true);
    expect(fs.existsSync(foreign)).toBe(true); // non-dump dir untouched
  });

  it('never throws when the dump dir disappears mid-session (best-effort writes)', async () => {
    const dump = createSessionDump({ baseDir })!;
    const inner: GrammarCapableSidecar = {
      generateWithGrammar: vi.fn().mockResolvedValue({
        text: '{"ok":1}',
        seed: 5000,
        stats: { tokensOut: 7, genMs: 12 },
      }),
    };
    const wrapped = dump.wrapSidecar(inner);
    fs.rmSync(dump.dir, { recursive: true, force: true });

    // The LLM call must still succeed; the dump write failure is swallowed.
    const r = await wrapped.generateWithGrammar({
      prompt: 'p',
      grammar: 'root ::= "x"',
      seed: 5000,
      temperature: 0.4,
      maxTokens: 2048,
    });
    expect(r.text).toBe('{"ok":1}');
    expect(() =>
      dump.writeResult({ ok: false, family: 'lecture', error: 'X' }),
    ).not.toThrow();
    expect(() =>
      dump.writeTranscript({ sessionId: 'live', language: 'ja', llmModel: 'm', segments: [] }),
    ).not.toThrow();
  });
});
