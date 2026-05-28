import { describe, it, expect } from 'vitest';
import { buildRetryHistogram } from './retry-histogram';

describe('buildRetryHistogram', () => {
  it('bins attempts and computes mean', () => {
    const h = buildRetryHistogram([1, 1, 1, 1, 2]);
    expect(h.samples).toBe(5);
    expect(h.attemptsMean).toBeCloseTo(1.2, 2);
    expect(h.attemptsByBin).toEqual({ '1': 4, '2': 1, '3': 0 });
  });

  it('handles empty input', () => {
    const h = buildRetryHistogram([]);
    expect(h.samples).toBe(0);
    expect(h.attemptsMean).toBe(0);
  });

  it('merges 3 into 3+ when overflow exists', () => {
    const h = buildRetryHistogram([1, 2, 3, 4, 5]);
    expect(h.attemptsByBin['1']).toBe(1);
    expect(h.attemptsByBin['2']).toBe(1);
    expect(h.attemptsByBin['3+']).toBe(3);
    expect(h.attemptsByBin['3']).toBeUndefined();
  });

  it('reports zero-attempt cases without inventing keys', () => {
    const h = buildRetryHistogram([1, 1]);
    expect(h.attemptsByBin).toEqual({ '1': 2, '2': 0, '3': 0 });
  });
});
