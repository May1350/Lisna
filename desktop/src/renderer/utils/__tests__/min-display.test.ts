import { describe, it, expect } from 'vitest';
import { computeMinDisplayDelay } from '../min-display';

describe('computeMinDisplayDelay', () => {
  it('returns 0 when the min-display window has already elapsed', () => {
    // 2000ms have passed since last display change, well past 1500ms min.
    expect(computeMinDisplayDelay(1000, 3000, 1500)).toBe(0);
  });

  it('returns the remaining ms when within the window', () => {
    // 500ms elapsed, 1500ms required → 1000ms remaining.
    expect(computeMinDisplayDelay(1000, 1500, 1500)).toBe(1000);
  });

  it('returns 0 when now equals the lower edge of the window', () => {
    // Exactly minDisplayMs elapsed → free to update immediately.
    expect(computeMinDisplayDelay(1000, 2500, 1500)).toBe(0);
  });

  it('returns 0 when lastChangeAt is in the future (clock skew defense)', () => {
    // Defensive: a future timestamp shouldn't compute as "negative wait".
    expect(computeMinDisplayDelay(5000, 1000, 1500)).toBe(0);
  });

  it('returns 0 when minDisplayMs is 0 (feature disabled)', () => {
    expect(computeMinDisplayDelay(0, 100, 0)).toBe(0);
  });
});
