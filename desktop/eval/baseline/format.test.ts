import { describe, it, expect } from 'vitest';
import { BaselineFileSchema } from './format';

describe('BaselineFileSchema', () => {
  it('parses a valid baseline', () => {
    const file = {
      savedAt: '2026-05-27T00:00:00Z',
      modelId: 'llama-3.2-3b-q4-km',
      promptVariantId: 'v1-baseline',
      judgeModelId: 'llama-3.3-70b-versatile',
      results: [{
        fixtureId: 'procedural-physics-em',
        family: 'lecture',
        contractTest: { schemaParse: 'PASS', overall: 'PASS', findings: [] },
        judge: {
          family: 'lecture', judgeModelId: 'llama-3.3-70b-versatile',
          axes: { coverage: 7, accuracy: 7, hierarchy: 6, conciseness: 6, importance: 5, provenance: 8, sectionCoherence: 7, contentFidelity: 2 },
          overall: 6.0, issues: ['E=mc² parroted'], wins: ['JA section titles coherent'],
        },
        contentFidelity: { score: 2, parroting: true, evidence: ['no E=mc^2 in transcript'], judgeModelId: 'llama-3.3-70b-versatile' },
        retryHistogram: { samples: 1, attemptsMean: 1.0, attemptsByBin: { '1': 1, '2': 0, '3': 0 } },
        slotDistribution: { slotTypes: 1, slotsEmerged: 4, byType: { formula: 4 } },
        runMs: 72073,
      }],
    };
    expect(BaselineFileSchema.safeParse(file).success).toBe(true);
  });

  it('rejects baseline missing required modelId', () => {
    const bad = {
      savedAt: '2026-05-27T00:00:00Z',
      promptVariantId: 'v1',
      judgeModelId: 'judge',
      results: [],
    };
    expect(BaselineFileSchema.safeParse(bad).success).toBe(false);
  });

  it('accepts FixtureResult with optional judge/contentFidelity omitted', () => {
    const file = {
      savedAt: '2026-05-27T00:00:00Z',
      modelId: 'm',
      promptVariantId: 'p',
      judgeModelId: 'j',
      results: [{
        fixtureId: 'fx',
        family: 'meeting',
        contractTest: { schemaParse: 'PASS', overall: 'PASS', findings: [] },
        runMs: 100,
      }],
    };
    expect(BaselineFileSchema.safeParse(file).success).toBe(true);
  });
});
