import { describe, it, expect } from 'vitest';
import { modelProfiles, getModelProfile } from '../profiles';

describe('modelProfiles', () => {
  it('includes the default llama-3.2-3b-q4-km entry', () => {
    const p = modelProfiles['llama-3.2-3b-q4-km'];
    expect(p).toBeDefined();
    expect(p!.contextWindow).toBe(16384);
    expect(p!.chatTemplate).toBe('llama-3.2');
    expect(p!.grammarDialect).toBe('llama-cpp');
    expect(p!.perFamily.lecture.recommendedChunkTokens).toBeLessThanOrEqual(p!.contextWindow);
  });

  it('getModelProfile returns the profile for a known id', () => {
    const p = getModelProfile('llama-3.2-3b-q4-km');
    expect(p.id).toBe('llama-3.2-3b-q4-km');
  });

  it('getModelProfile throws on unknown id', () => {
    expect(() => getModelProfile('phantom-model')).toThrow();
  });

  // 2026-06-11: lowered from 8000 (lecture/meeting) / 7000 (interview/brainstorm)
  // to a uniform 3000 so a 17–21-min recording multi-chunks instead of dying in a
  // single oversized prefill under 8 GB memory pressure (v0.1.4 retest: 17.4-min
  // interview, 3× prefill-stalled with zero output). Reliability over nominal
  // wall-time; the 3B merge path is deterministic + already multi-chunk tested.
  // The 1B chunk size is intentionally left for the adaptive-infra design phase.
  it('default (3B) profile uses the lowered 3000-token chunk budget for every family', () => {
    const p = getModelProfile('llama-3.2-3b-q4-km');
    for (const family of Object.keys(p.perFamily) as Array<keyof typeof p.perFamily>) {
      expect(p.perFamily[family].recommendedChunkTokens).toBe(3000);
    }
  });

  it('every profile has positive ramBudgetMB and per-family recommendedChunkTokens', () => {
    for (const id of Object.keys(modelProfiles)) {
      const p = modelProfiles[id]!;
      expect(p.ramBudgetMB).toBeGreaterThan(0);
      for (const family of Object.keys(p.perFamily) as Array<keyof typeof p.perFamily>) {
        expect(p.perFamily[family].recommendedChunkTokens).toBeGreaterThan(0);
      }
    }
  });
});
