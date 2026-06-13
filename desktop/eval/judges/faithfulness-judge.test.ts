import { describe, it, expect } from 'vitest';
import {
  __testOnly_parseFaithfulness,
  gateFromVerdicts,
  FAITHFULNESS_UNSUPPORTED_TOLERANCE,
} from './faithfulness-judge';

describe('parseFaithfulness', () => {
  it('parses per-claim verdicts and computes unsupportedCount + overall', () => {
    const r = __testOnly_parseFaithfulness(JSON.stringify({
      verdicts: [
        { claim: '売上は減少した', verdict: 'supported', span: 'qa_pairs[0].answer' },
        { claim: 'EBITDA margin 22%', verdict: 'unsupported', span: 'themes[1].name' },
      ],
    }));
    expect(r.verdicts).toHaveLength(2);
    expect(r.unsupportedCount).toBe(1);
    expect(r.overall).toBe('FAIL');   // 1 unsupported > tolerance 0
  });

  it('PASS when all verdicts are supported', () => {
    const r = __testOnly_parseFaithfulness(JSON.stringify({
      verdicts: [{ claim: 'a', verdict: 'supported', span: 'x' }],
    }));
    expect(r.unsupportedCount).toBe(0);
    expect(r.overall).toBe('PASS');
  });

  it('treats partial as NOT unsupported (only hard unsupported gates)', () => {
    const r = __testOnly_parseFaithfulness(JSON.stringify({
      verdicts: [{ claim: 'a', verdict: 'partial', span: 'x' }],
    }));
    expect(r.unsupportedCount).toBe(0);
    expect(r.overall).toBe('PASS');
  });

  it('coerces an unknown verdict string to unsupported (safe default)', () => {
    const r = __testOnly_parseFaithfulness(JSON.stringify({
      verdicts: [{ claim: 'a', verdict: 'maybe', span: '' }],
    }));
    expect(r.verdicts[0].verdict).toBe('unsupported');
    expect(r.overall).toBe('FAIL');
  });

  it('malformed JSON → FAIL with zero verdicts (never silently PASS)', () => {
    const r = __testOnly_parseFaithfulness('not json');
    expect(r.verdicts).toEqual([]);
    expect(r.overall).toBe('FAIL');
  });

  it('gateFromVerdicts respects the tolerance constant', () => {
    expect(FAITHFULNESS_UNSUPPORTED_TOLERANCE).toBe(0);
    expect(gateFromVerdicts(0)).toBe('PASS');
    expect(gateFromVerdicts(1)).toBe('FAIL');
  });
});

describe('judge-sanity (shape contract, no network)', () => {
  // A judge that saw a FAITHFUL JA note returns all-supported.
  const FAITHFUL_RESPONSE = JSON.stringify({
    verdicts: [
      { claim: '売上は前年比で減少した', verdict: 'supported', span: 'qa_pairs[0].answer' },
      { claim: '原価率の改善を最優先にする', verdict: 'supported', span: 'key_takeaways[0]' },
    ],
  });
  // A judge that saw a FABRICATED English note returns unsupported on the invented claim.
  const FABRICATED_RESPONSE = JSON.stringify({
    verdicts: [
      { claim: 'Revenue grew 30% YoY', verdict: 'unsupported', span: 'themes[0].name' },
      { claim: 'EBITDA margin reached 22%', verdict: 'unsupported', span: 'themes[1].name' },
    ],
  });

  it('faithful judge response → PASS', () => {
    expect(__testOnly_parseFaithfulness(FAITHFUL_RESPONSE).overall).toBe('PASS');
  });

  it('fabricated judge response → FAIL with both spans cited', () => {
    const r = __testOnly_parseFaithfulness(FABRICATED_RESPONSE);
    expect(r.overall).toBe('FAIL');
    expect(r.unsupportedCount).toBe(2);
    expect(r.verdicts.map(v => v.span)).toEqual(['themes[0].name', 'themes[1].name']);
  });

  it('a judge that flips everything to supported CANNOT hide an empty-verdicts response', () => {
    // Guard: an empty verdict list is treated as FAIL, so a judge returning {} can't pass.
    expect(__testOnly_parseFaithfulness('{}').overall).toBe('FAIL');
  });
});
