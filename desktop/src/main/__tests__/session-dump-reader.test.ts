/**
 * Tests for session-dump-reader — Electron-free (injected baseDir on tmp
 * dirs), mirroring the session-debug-dump lifecycle test pattern.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listDumps, loadDumpTranscript } from '../session-dump-reader';

let base: string;

function writeDump(
  id: string,
  transcript: unknown | null,
  result?: unknown,
): void {
  const dir = path.join(base, id);
  fs.mkdirSync(dir, { recursive: true });
  if (transcript !== null) {
    fs.writeFileSync(path.join(dir, 'transcript.json'), JSON.stringify(transcript));
  }
  if (result !== undefined) {
    fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result));
  }
}

const T1 = {
  sessionId: 'live',
  language: 'ja',
  llmModel: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
  segmentCount: 2,
  durationSec: 5,
  segments: [
    { startSec: 0, endSec: 2, text: 'こんにちは' },
    { startSec: 2, endSec: 5, text: 'テストです' },
  ],
};

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'dump-reader-'));
});
afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

describe('listDumps', () => {
  it('returns newest-first summaries with precomputed fields + result meta', () => {
    writeDump('2026-06-10T01-00-00-000Z', T1, { ok: true, family: 'lecture', finishedAt: 'x' });
    writeDump('2026-06-11T01-00-00-000Z', { ...T1, language: 'en' });
    const rows = listDumps(base);
    expect(rows.map((r) => r.id)).toEqual([
      '2026-06-11T01-00-00-000Z',
      '2026-06-10T01-00-00-000Z',
    ]);
    expect(rows[1]).toMatchObject({
      language: 'ja',
      llmModel: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
      segmentCount: 2,
      durationSec: 5,
      family: 'lecture',
      ok: true,
    });
    expect(rows[0]!.recordedAt).toBe('2026-06-11T01:00:00.000Z');
    expect(rows[0]!.ok).toBeUndefined(); // no result.json
  });

  it('marks a dump with missing/corrupt transcript.json unreadable instead of dropping it', () => {
    writeDump('2026-06-10T01-00-00-000Z', null); // no transcript.json
    const dir = path.join(base, '2026-06-11T01-00-00-000Z');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'transcript.json'), '{not json');
    const rows = listDumps(base);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.unreadable)).toBe(true);
  });

  it('returns [] for a missing base dir and ignores non-dump dirs/files', () => {
    expect(listDumps(path.join(base, 'nope'))).toEqual([]);
    writeDump('2026-06-10T01-00-00-000Z', T1);
    fs.mkdirSync(path.join(base, 'not-a-dump'));
    fs.writeFileSync(path.join(base, 'stray.txt'), 'x');
    expect(listDumps(base).map((r) => r.id)).toEqual(['2026-06-10T01-00-00-000Z']);
  });

  it('falls back to segments when precomputed fields are absent', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { segmentCount, durationSec, ...noPrecomputed } = T1;
    writeDump('2026-06-10T01-00-00-000Z', noPrecomputed);
    const row = listDumps(base)[0]!;
    expect(row.segmentCount).toBe(2);
    expect(row.durationSec).toBe(5);
  });
});

describe('loadDumpTranscript', () => {
  it('returns the full transcript payload', () => {
    writeDump('2026-06-10T01-00-00-000Z', T1);
    const t = loadDumpTranscript(base, '2026-06-10T01-00-00-000Z');
    expect(t.segments).toHaveLength(2);
    expect(t.language).toBe('ja');
  });

  it('rejects ids that do not match the dump dir shape (traversal guard)', () => {
    for (const bad of ['../../etc', 'x', '2026-06-10', '2026-06-10T01-00-00-000Z/../x']) {
      expect(() => loadDumpTranscript(base, bad)).toThrow('INVALID_DUMP_ID');
    }
  });

  it('rejects a valid-shaped id that resolves outside base (parent-equality guard)', () => {
    // A symlinked dump dir pointing elsewhere must fail realpath parent equality.
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-'));
    fs.writeFileSync(path.join(outside, 'transcript.json'), JSON.stringify(T1));
    fs.symlinkSync(outside, path.join(base, '2026-06-10T01-00-00-000Z'));
    expect(() => loadDumpTranscript(base, '2026-06-10T01-00-00-000Z')).toThrow('INVALID_DUMP_ID');
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it('throws DUMP_NOT_FOUND for an absent dump and DUMP_UNREADABLE for corrupt json', () => {
    expect(() => loadDumpTranscript(base, '2026-06-10T01-00-00-000Z')).toThrow('DUMP_NOT_FOUND');
    const dir = path.join(base, '2026-06-10T01-00-00-000Z');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'transcript.json'), '{nope');
    expect(() => loadDumpTranscript(base, '2026-06-10T01-00-00-000Z')).toThrow('DUMP_UNREADABLE');
  });
});
