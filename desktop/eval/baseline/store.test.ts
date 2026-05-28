import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { saveBaseline, loadBaseline } from './store';

describe('baseline store roundtrip', () => {
  it('saves and loads a baseline', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baseline-'));
    const path = join(dir, 'v0.json');
    const baseline = {
      savedAt: '2026-05-27T00:00:00Z',
      modelId: 'llama-3.2-3b-q4-km',
      promptVariantId: 'v1-baseline',
      judgeModelId: 'llama-3.3-70b-versatile',
      results: [],
    };
    saveBaseline(path, baseline);
    const loaded = loadBaseline(path);
    expect(loaded?.modelId).toBe('llama-3.2-3b-q4-km');
  });

  it('loadBaseline returns null for missing file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baseline-'));
    const path = join(dir, 'nonexistent.json');
    expect(loadBaseline(path)).toBeNull();
  });

  it('saveBaseline rejects malformed input via Zod', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baseline-'));
    const path = join(dir, 'bad.json');
    expect(() => saveBaseline(path, { modelId: 'm' } as any)).toThrow();
  });
});
