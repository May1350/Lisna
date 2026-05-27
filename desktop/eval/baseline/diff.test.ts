import { describe, it, expect } from 'vitest';
import { diffBaselines } from './diff';
import type { BaselineFile } from './format';

const make = (judgeOverall: number): BaselineFile => ({
  savedAt: '2026-05-27T00:00:00Z',
  modelId: 'llama-3.2-3b-q4-km',
  promptVariantId: 'v1',
  judgeModelId: 'llama-3.3-70b-versatile',
  results: [{
    fixtureId: 'fx',
    family: 'lecture',
    contractTest: { schemaParse: 'PASS', overall: 'PASS', findings: [] },
    judge: {
      family: 'lecture', judgeModelId: 'llama-3.3-70b-versatile',
      axes: { coverage: 7, accuracy: 7, hierarchy: 6, conciseness: 6, importance: 5, provenance: 8, sectionCoherence: 7, contentFidelity: 5 },
      overall: judgeOverall, issues: [], wins: [],
    },
    runMs: 1000,
  }],
});

describe('diffBaselines', () => {
  it('reports +0.5 overall delta when B improves over A', () => {
    const d = diffBaselines(make(6.0), make(6.5));
    expect(d.perFixture[0].overallDelta).toBe(0.5);
    expect(d.summary.regression).toBe(false);
  });

  it('flags regression when B drops below A by ≥0.3 overall', () => {
    const d = diffBaselines(make(6.5), make(6.1));
    expect(d.summary.regression).toBe(true);
  });

  it('warns on judge-model mismatch', () => {
    const a = make(6.0);
    const b = make(6.0);
    b.judgeModelId = 'claude-opus-4-x';
    const d = diffBaselines(a, b);
    expect(d.warnings.some(w => w.includes('judgeModelId mismatch'))).toBe(true);
  });

  it('flags contract-test regression when A:PASS → B:FAIL', () => {
    const a = make(6.0);
    const b = make(6.0);
    b.results[0].contractTest.overall = 'FAIL';
    const d = diffBaselines(a, b);
    expect(d.perFixture[0].contractTestRegression).toBe(true);
    expect(d.summary.regression).toBe(true);
  });
});
