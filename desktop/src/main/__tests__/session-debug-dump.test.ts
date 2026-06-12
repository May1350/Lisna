/**
 * Core dump-content tests for createSessionDump (finalize debug dump,
 * 2026-06-11): transcript, per-call prompt + raw LLM output, grammar dedup,
 * result/note. Lifecycle + robustness (opt-out env, collision, retention,
 * best-effort writes) live in session-debug-dump-lifecycle.test.ts.
 * The module is electron-free (baseDir injected) so these tests run on
 * plain tmp dirs without mocking electron.
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
});

function readNdjson(dir: string): Array<Record<string, unknown>> {
  const raw = fs.readFileSync(path.join(dir, 'llm-calls.ndjson'), 'utf8');
  return raw.trimEnd().split('\n').map((l) => JSON.parse(l));
}

function makeInnerSidecar(text = '{"a":1}'): GrammarCapableSidecar {
  return {
    generateWithGrammar: vi.fn().mockResolvedValue({
      text,
      seed: 5000,
      stats: { tokensOut: 7, genMs: 12 },
    }),
  };
}

const CALL_OPTS = {
  prompt: '講義の文字起こしです。[0:05] こんにちは',
  grammar: 'root ::= "x"',
  seed: 5000,
  temperature: 0.4,
  maxTokens: 2048,
};

describe('createSessionDump', () => {
  it('creates a timestamp-named directory under baseDir', () => {
    const dump = createSessionDump({ baseDir });
    expect(dump).not.toBeNull();
    expect(path.dirname(dump!.dir)).toBe(baseDir);
    expect(path.basename(dump!.dir)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z/);
    expect(fs.statSync(dump!.dir).isDirectory()).toBe(true);
  });

  it('writeTranscript writes transcript.json with segments + session meta', () => {
    const dump = createSessionDump({ baseDir })!;
    dump.writeTranscript({
      sessionId: 'live',
      language: 'ja',
      llmModel: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
      segments: [
        { startSec: 0, endSec: 4, text: 'こんにちは' },
        { startSec: 4, endSec: 9, text: '今日は講義です', noSpeechProb: 0.1 },
      ],
    });
    const t = JSON.parse(fs.readFileSync(path.join(dump.dir, 'transcript.json'), 'utf8'));
    expect(t.sessionId).toBe('live');
    expect(t.language).toBe('ja');
    expect(t.llmModel).toBe('Llama-3.2-3B-Instruct-Q4_K_M.gguf');
    expect(t.segmentCount).toBe(2);
    expect(t.durationSec).toBe(9);
    expect(t.segments[0]).toMatchObject({ startSec: 0, endSec: 4, text: 'こんにちは' });
    expect(t.segments[1]).toMatchObject({ noSpeechProb: 0.1 });
  });

  it('wrapSidecar records prompt + raw output per call and passes the result through', async () => {
    const dump = createSessionDump({ baseDir })!;
    const inner = makeInnerSidecar('{"title":"テスト"}');
    const wrapped = dump.wrapSidecar(inner);

    const r1 = await wrapped.generateWithGrammar(CALL_OPTS);
    const r2 = await wrapped.generateWithGrammar({ ...CALL_OPTS, seed: 5100 });

    // Pass-through untouched
    expect(r1).toEqual({ text: '{"title":"テスト"}', seed: 5000, stats: { tokensOut: 7, genMs: 12 } });
    expect(inner.generateWithGrammar).toHaveBeenCalledTimes(2);

    const lines = readNdjson(dump.dir);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      index: 0,
      ok: true,
      seed: 5000,
      temperature: 0.4,
      maxTokens: 2048,
      prompt: CALL_OPTS.prompt,
      rawText: '{"title":"テスト"}',
      tokensOut: 7,
      genMs: 12,
    });
    expect(lines[1]).toMatchObject({ index: 1, seed: 5100 });
    expect(typeof lines[0]!.latencyMs).toBe('number');
    expect(r2.text).toBe('{"title":"テスト"}');
  });

  it('wrapSidecar records sampling and appliedSampling in the ndjson line', async () => {
    const dump = createSessionDump({ baseDir })!;
    const inner: GrammarCapableSidecar = {
      generateWithGrammar: vi.fn().mockResolvedValue({
        text: '{"ok":1}',
        seed: 5000,
        stats: { tokensOut: 5, genMs: 10, appliedSampling: { topK: 40 } },
      }),
    };
    const wrapped = dump.wrapSidecar(inner);
    await wrapped.generateWithGrammar({ ...CALL_OPTS, sampling: { topK: 40 } });

    const lines = readNdjson(dump.dir);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      sampling: { topK: 40 },
      appliedSampling: { topK: 40 },
    });
  });

  it('wrapSidecar records a failed call with the error and rethrows', async () => {
    const dump = createSessionDump({ baseDir })!;
    const inner: GrammarCapableSidecar = {
      generateWithGrammar: vi.fn().mockRejectedValue(new Error('GENERATE_TIMEOUT')),
    };
    const wrapped = dump.wrapSidecar(inner);

    await expect(wrapped.generateWithGrammar(CALL_OPTS)).rejects.toThrow('GENERATE_TIMEOUT');

    const lines = readNdjson(dump.dir);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ index: 0, ok: false, error: 'GENERATE_TIMEOUT' });
    expect(lines[0]!.rawText).toBeUndefined();
  });

  it('deduplicates the grammar to one .gbnf file per distinct grammar', async () => {
    const dump = createSessionDump({ baseDir })!;
    const wrapped = dump.wrapSidecar(makeInnerSidecar());

    await wrapped.generateWithGrammar(CALL_OPTS);
    await wrapped.generateWithGrammar({ ...CALL_OPTS, seed: 5100 });
    await wrapped.generateWithGrammar({ ...CALL_OPTS, grammar: 'root ::= "y"', seed: 7500 });

    const lines = readNdjson(dump.dir);
    expect(lines[0]!.grammarFile).toBe('grammar-0.gbnf');
    expect(lines[1]!.grammarFile).toBe('grammar-0.gbnf');
    expect(lines[2]!.grammarFile).toBe('grammar-1.gbnf');
    expect(fs.readFileSync(path.join(dump.dir, 'grammar-0.gbnf'), 'utf8')).toBe('root ::= "x"');
    expect(fs.readFileSync(path.join(dump.dir, 'grammar-1.gbnf'), 'utf8')).toBe('root ::= "y"');
    // Grammar content is NOT duplicated into every line
    expect(lines[0]!.grammar).toBeUndefined();
  });

  it('writeResult on success writes result.json + note.json', () => {
    const dump = createSessionDump({ baseDir })!;
    const note = { family: 'lecture', title: 'テスト講義', sections: [] };
    dump.writeResult({ ok: true, family: 'lecture', note });

    const result = JSON.parse(fs.readFileSync(path.join(dump.dir, 'result.json'), 'utf8'));
    expect(result).toMatchObject({ ok: true, family: 'lecture' });
    expect(typeof result.finishedAt).toBe('string');
    const written = JSON.parse(fs.readFileSync(path.join(dump.dir, 'note.json'), 'utf8'));
    expect(written).toEqual(note);
  });

  it('writeResult on failure writes result.json with the error and no note.json', () => {
    const dump = createSessionDump({ baseDir })!;
    dump.writeResult({ ok: false, family: 'lecture', error: 'CHUNK_FAILED:0:POST_DECODE_ZOD_EXHAUSTED' });

    const result = JSON.parse(fs.readFileSync(path.join(dump.dir, 'result.json'), 'utf8'));
    expect(result).toMatchObject({
      ok: false,
      family: 'lecture',
      error: 'CHUNK_FAILED:0:POST_DECODE_ZOD_EXHAUSTED',
    });
    expect(fs.existsSync(path.join(dump.dir, 'note.json'))).toBe(false);
  });
});
