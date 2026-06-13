import { describe, it, expect } from 'vitest';
import { formatScorecard, __testOnly_gateVerdict } from './scorecard';
import type { FixtureResult } from './baseline/format';

const result: FixtureResult = {
  fixtureId: 'procedural-physics-em',
  family: 'lecture',
  contractTest: { schemaParse: 'PASS', overall: 'PASS', findings: [
    { ruleId: 'lecture-anti-parroting', severity: 'warning', pass: false, message: 'parrot ratio 50%' },
  ] },
  judge: {
    family: 'lecture', judgeModelId: 'llama-3.3-70b-versatile',
    axes: { coverage: 7, accuracy: 6.5, hierarchy: 7, conciseness: 6, importance: 5, provenance: 8, sectionCoherence: 7, contentFidelity: 3 },
    overall: 6.2, issues: ['E=mc² parroted'], wins: ['JA section headings coherent'],
  },
  runMs: 72000,
};

describe('formatScorecard', () => {
  it('renders fixture detail + axes + issues + wins', () => {
    const text = formatScorecard([result]);
    expect(text).toContain('procedural-physics-em');
    expect(text).toContain('overall');
    expect(text).toContain('contentFidelity');
    expect(text).toContain('E=mc² parroted');
    expect(text).toContain('JA section headings coherent');
    expect(text).toContain('lecture-anti-parroting');
  });

  it('renders contract-test failures prominently', () => {
    const failed: FixtureResult = { ...result, contractTest: { schemaParse: 'FAIL', overall: 'FAIL', findings: [], schemaParseError: 'missing field title' } };
    const text = formatScorecard([failed]);
    expect(text).toContain('CONTRACT FAIL');
  });

  it('renders aggregate row for multiple fixtures', () => {
    const text = formatScorecard([result, { ...result, fixtureId: 'fx-b', judge: { ...result.judge!, overall: 7.4 } }]);
    expect(text).toContain('AGGREGATE');
    expect(text).toContain('mean overall');
  });
});

describe('formatScorecard — faithfulness gate + coverage', () => {
  const base: FixtureResult = {
    fixtureId: 'finance-fabrication-2spk',
    family: 'interview',
    contractTest: { schemaParse: 'PASS', overall: 'PASS', findings: [] },
    runMs: 30000,
  };

  it('renders FAITHFULNESS FAIL with unsupported spans', () => {
    const r: FixtureResult = {
      ...base,
      faithfulness: {
        prepass: { jaRatio: 0.02, languageFlip: true, groundingJa: 0, groundingAscii: 0.1 },
        judge: { verdicts: [{ claim: 'Revenue grew 30%', verdict: 'unsupported', span: 'themes[0].name' }], unsupportedCount: 1, overall: 'FAIL', judgeModelId: 'claude-3-5-sonnet-latest' },
        gate: 'FAIL',
      },
      coverage: { captured: 0, total: 4, ratio: 0, missing: ['今期の財務状況', '利益への影響', '改善の優先順位', '資金繰りの状況'] },
    };
    const text = formatScorecard([r]);
    expect(text).toContain('FAITHFULNESS: FAIL');
    expect(text).toContain('language flip');         // pre-pass reason surfaced
    expect(text).toContain('Revenue grew 30%');      // fabricated claim surfaced
    expect(text).toContain('coverage');
    expect(text).toContain('0/4');                   // coverage count
  });

  it('renders FAITHFULNESS PASS when gate passes', () => {
    const r: FixtureResult = {
      ...base,
      faithfulness: { prepass: { jaRatio: 0.6, languageFlip: false, groundingJa: 0.9, groundingAscii: 0 }, judge: { verdicts: [{ claim: '売上は減少', verdict: 'supported', span: 'qa_pairs[0]' }], unsupportedCount: 0, overall: 'PASS', judgeModelId: 'claude-3-5-sonnet-latest' }, gate: 'PASS' },
      coverage: { captured: 4, total: 4, ratio: 1, missing: [] },
    };
    const text = formatScorecard([r]);
    expect(text).toContain('FAITHFULNESS: PASS');
    expect(text).toContain('4/4');
  });

  it('__testOnly_gateVerdict: any FAIL fixture makes the suite gate FAIL', () => {
    const pass: FixtureResult = { ...base, faithfulness: { prepass: { jaRatio: 0.6, languageFlip: false, groundingJa: 1, groundingAscii: 0 }, gate: 'PASS' } };
    const fail: FixtureResult = { ...base, fixtureId: 'b', faithfulness: { prepass: { jaRatio: 0.0, languageFlip: true, groundingJa: 0, groundingAscii: 0 }, gate: 'FAIL' } };
    expect(__testOnly_gateVerdict([pass])).toBe('PASS');
    expect(__testOnly_gateVerdict([pass, fail])).toBe('FAIL');
    expect(__testOnly_gateVerdict([{ ...base }])).toBe('PASS'); // no faithfulness block → not gated
  });
});
