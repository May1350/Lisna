import { describe, it, expect } from 'vitest';
import { modelProfiles, getModelProfile } from '../profiles';

describe('ModelProfile Lecture tuning', () => {
  it('3B profile lecture tier is default (Path F: 3B passes Lecture quality)', () => {
    const p = getModelProfile('llama-3.2-3b-q4-km');
    expect(p.perFamily.lecture.tier).toBe('default');
  });

  it('3B profile lecture maxGenTokens is 3000 (Path G tail-risk mitigation)', () => {
    const p = getModelProfile('llama-3.2-3b-q4-km');
    expect(p.perFamily.lecture.maxGenTokens).toBe(3000);
  });

  it('3B profile lecture recommendedChunkTokens is 8000 (spec §2.3)', () => {
    const p = getModelProfile('llama-3.2-3b-q4-km');
    expect(p.perFamily.lecture.recommendedChunkTokens).toBe(8000);
  });

  it('3B profile lecture temperature is 0.4', () => {
    expect(getModelProfile('llama-3.2-3b-q4-km').perFamily.lecture.temperature).toBe(0.4);
  });

  it('1B profile lecture tier is fallback (Path F: 1B quality FAIL until Plan 6 T16)', () => {
    const p = getModelProfile('llama-3.2-1b-q4-km');
    expect(p.perFamily.lecture.tier).toBe('fallback');
  });

  it('every model profile has all 4 families in perFamily', () => {
    for (const profile of Object.values(modelProfiles)) {
      expect(Object.keys(profile.perFamily).sort()).toEqual(
        ['brainstorm', 'interview', 'lecture', 'meeting'],
      );
    }
  });

  it('every per-family tuning has positive recommendedChunkTokens, maxGenTokens, and temperature', () => {
    for (const profile of Object.values(modelProfiles)) {
      for (const tuning of Object.values(profile.perFamily)) {
        expect(tuning.recommendedChunkTokens).toBeGreaterThan(0);
        expect(tuning.maxGenTokens).toBeGreaterThan(0);
        expect(tuning.temperature).toBeGreaterThan(0);
        expect(['default', 'fallback']).toContain(tuning.tier);
      }
    }
  });
});
