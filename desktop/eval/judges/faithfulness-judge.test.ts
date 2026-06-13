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
