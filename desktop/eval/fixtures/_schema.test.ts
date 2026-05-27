// desktop/eval/fixtures/_schema.test.ts
import { describe, it, expect } from 'vitest';
import {
  FixtureMetaSchema,
  FixtureGroundTruthSchema,
  type FixtureMeta,
} from './_schema';

describe('FixtureMetaSchema', () => {
  it('parses a minimal Lecture meta', () => {
    const meta = {
      fixtureId: 'procedural-physics-em',
      family: 'lecture',
      language: 'ja',
      durationSec: 660,
      bucketSeconds: 10,
      scenarioTags: ['physics', 'procedural'],
      expectedSlots: ['formula'],
      sourceUrl: 'https://www.youtube.com/watch?v=Qx1n-U1ciD0',
    } satisfies FixtureMeta;
    expect(FixtureMetaSchema.safeParse(meta).success).toBe(true);
  });

  it('rejects Lecture meta with expectedSlots when family is meeting', () => {
    const meta = {
      fixtureId: 'sprint-planning',
      family: 'meeting',
      language: 'ja',
      durationSec: 1800,
      bucketSeconds: 10,
      scenarioTags: ['planning'],
      expectedSlots: ['formula'], // only Lecture has slots
      sourceUrl: null,
    };
    const parsed = FixtureMetaSchema.safeParse(meta);
    expect(parsed.success).toBe(false);
  });

  it('parses a Meeting ground-truth with decisions + action items', () => {
    const gt = {
      fixtureId: 'sprint-planning',
      decisions: [
        { text: 'Ship payment refactor in 2026-Q3', mustAppear: true },
      ],
      actionItems: [
        { text: 'Tanaka writes RFC by Friday', mustAppear: true },
      ],
      participantCount: 4,
    };
    expect(FixtureGroundTruthSchema.safeParse(gt).success).toBe(true);
  });
});
