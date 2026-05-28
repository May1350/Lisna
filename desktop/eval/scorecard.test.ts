import { describe, it, expect } from 'vitest';
import { formatScorecard } from './scorecard';
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
