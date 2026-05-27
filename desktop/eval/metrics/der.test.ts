import { describe, it, expect } from 'vitest';
import { computeDer, type DiarizationSegment } from './der';

const truth: DiarizationSegment[] = [
  { start: 0, end: 10, speakerId: 0 },
  { start: 10, end: 20, speakerId: 1 },
];

describe('computeDer', () => {
  it('returns 0 when prediction matches truth exactly', () => {
    expect(computeDer(truth, truth)).toBeCloseTo(0, 2);
  });

  it('returns high error when prediction is a single wrong speaker for all time', () => {
    const pred: DiarizationSegment[] = [{ start: 0, end: 20, speakerId: 99 }];
    const score = computeDer(truth, pred);
    // Greedy map assigns 99→0 (10s overlap); remaining 10s for truth=1 are confusion.
    // DER = 10 confused / 20 speech = 0.5. Must be >= 0.5.
    expect(score).toBeGreaterThanOrEqual(0.5);
  });

  it('returns 0 for empty truth + empty prediction', () => {
    expect(computeDer([], [])).toBe(0);
  });

  it('handles partial coverage (truth has silence, pred speaks)', () => {
    const t: DiarizationSegment[] = [{ start: 0, end: 5, speakerId: 0 }];
    const p: DiarizationSegment[] = [{ start: 0, end: 10, speakerId: 0 }];
    const score = computeDer(t, p);
    expect(score).toBeGreaterThan(0); // false-alarm in last 5s
  });
});
