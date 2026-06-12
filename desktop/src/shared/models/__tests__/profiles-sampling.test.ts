import { describe, it, expect } from 'vitest';
import { modelProfiles, ALIGNED_SAMPLING } from '../profiles';

describe('model profile sampling blocks', () => {
  it('every profile carries the full aligned sampling block (spec section 5: TS always sends explicit values)', () => {
    for (const p of Object.values(modelProfiles)) {
      expect(p.sampling).toEqual(ALIGNED_SAMPLING);
    }
  });

  it('aligned values match llama.cpp common defaults + DRY enabled (spec section 4)', () => {
    expect(ALIGNED_SAMPLING).toEqual({
      topK: 40,
      topP: 0.95,
      minP: 0.05,
      repeatPenalty: 1.0,
      repeatLastN: 64,
      dryMultiplier: 0.8,
      dryBase: 1.75,
      dryAllowedLength: 2,
      dryPenaltyLastN: -1,
    });
  });
});
