import { describe, it, expect } from 'vitest';
import { modelProfiles, getModelProfile } from '../profiles';

describe('modelProfiles', () => {
  it('includes the default llama-3.2-3b-q4-km entry', () => {
    const p = modelProfiles['llama-3.2-3b-q4-km'];
    expect(p).toBeDefined();
    expect(p!.contextWindow).toBe(16384);
    expect(p!.chatTemplate).toBe('llama-3.2');
    expect(p!.grammarDialect).toBe('llama-cpp');
    expect(p!.recommendedChunkTokens).toBeLessThanOrEqual(p!.contextWindow);
  });

  it('getModelProfile returns the profile for a known id', () => {
    const p = getModelProfile('llama-3.2-3b-q4-km');
    expect(p.id).toBe('llama-3.2-3b-q4-km');
  });

  it('getModelProfile throws on unknown id', () => {
    expect(() => getModelProfile('phantom-model')).toThrow();
  });

  it('every profile has positive ramBudgetMB and recommendedChunkTokens', () => {
    for (const id of Object.keys(modelProfiles)) {
      const p = modelProfiles[id]!;
      expect(p.ramBudgetMB).toBeGreaterThan(0);
      expect(p.recommendedChunkTokens).toBeGreaterThan(0);
    }
  });
});
