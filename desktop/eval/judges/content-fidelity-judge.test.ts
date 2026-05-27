// desktop/eval/judges/content-fidelity-judge.test.ts
import { describe, it, expect } from 'vitest';
import { __testOnly_parseContentFidelity } from './content-fidelity-judge';

describe('parseContentFidelity', () => {
  it('parses a clean response', () => {
    const r = __testOnly_parseContentFidelity(JSON.stringify({
      score: 8.5, parroting: false, evidence: ['eq F=qE appears at 30s'],
    }));
    expect(r.score).toBe(8.5);
    expect(r.parroting).toBe(false);
    expect(r.evidence).toEqual(['eq F=qE appears at 30s']);
  });

  it('defaults missing fields safely', () => {
    const r = __testOnly_parseContentFidelity('{}');
    expect(r.score).toBe(0);
    expect(r.parroting).toBe(true);  // safe default: assume parroting if unclear
    expect(r.evidence).toEqual([]);
  });

  it('handles malformed JSON with safe defaults', () => {
    const r = __testOnly_parseContentFidelity('not valid json');
    expect(r.score).toBe(0);
    expect(r.parroting).toBe(true);
    expect(r.evidence).toEqual([]);
  });

  it('clamps out-of-range score to [0, 10]', () => {
    const r = __testOnly_parseContentFidelity(JSON.stringify({ score: 15, parroting: false }));
    expect(r.score).toBe(10);
    const r2 = __testOnly_parseContentFidelity(JSON.stringify({ score: -3, parroting: false }));
    expect(r2.score).toBe(0);
  });

  it('filters non-string evidence entries', () => {
    const r = __testOnly_parseContentFidelity(JSON.stringify({
      evidence: ['good', 42, null, 'also good'],
    }));
    expect(r.evidence).toEqual(['good', 'also good']);
  });

  it('treats non-boolean parroting as true (safe default)', () => {
    const r = __testOnly_parseContentFidelity(JSON.stringify({ parroting: 'maybe' }));
    expect(r.parroting).toBe(true);
  });
});
