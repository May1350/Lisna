// desktop/eval/fixtures/_schema.test.ts
import { describe, it, expect } from 'vitest';
import {
  FixtureMetaSchema,
  FixtureGroundTruthSchema,
  FixtureTranscriptSchema,
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

describe('FixtureTranscriptSchema', () => {
  it('parses a minimal transcript and applies speakerId default of 0', () => {
    const t = {
      bucket_seconds: 10,
      transcripts: [
        { ts: 0, text: 'hello' },
        { ts: 10, text: 'world' },
      ],
    };
    const parsed = FixtureTranscriptSchema.safeParse(t);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.transcripts[0].speakerId).toBe(0);
      expect(parsed.data.transcripts[1].speakerId).toBe(0);
      expect(parsed.data.speakers).toEqual([{ id: 0 }]);
    }
  });

  it('rejects transcript bucket with empty text', () => {
    const t = {
      bucket_seconds: 10,
      transcripts: [{ ts: 0, text: '' }],
    };
    expect(FixtureTranscriptSchema.safeParse(t).success).toBe(false);
  });
});

describe('FixtureGroundTruthSchema — Phase 1 answer-key fields', () => {
  it('accepts a facts[] answer key', () => {
    const gt = {
      fixtureId: 'finance-fabrication-2spk',
      facts: ['月次の売上は前年比で減少した', '原価率の改善を最優先にする'],
      qaPairs: [{ q: '売上の状況は', a: '前年比で減少', mustAppear: true }],
    };
    expect(FixtureGroundTruthSchema.safeParse(gt).success).toBe(true);
  });

  it('accepts qaPairs without mustAppear (back-compat with existing fixtures)', () => {
    const gt = {
      fixtureId: 'pm-candidate-2spk',
      qaPairs: [{ q: 'プロダクト失敗体験', a: 'ユーザー調査不足' }],
    };
    const parsed = FixtureGroundTruthSchema.safeParse(gt);
    expect(parsed.success).toBe(true);
  });

  it('accepts expectedKeyTerms as bare strings (lecture back-compat)', () => {
    const gt = { fixtureId: 'lec', expectedKeyTerms: ['電位', '静電ポテンシャル'] };
    expect(FixtureGroundTruthSchema.safeParse(gt).success).toBe(true);
  });

  it('accepts expectedKeyTerms as importance-tagged objects', () => {
    const gt = {
      fixtureId: 'lec',
      expectedKeyTerms: [{ term: '電位', mustAppear: true }, { term: '余談', mustAppear: false }],
    };
    expect(FixtureGroundTruthSchema.safeParse(gt).success).toBe(true);
  });

  it('rejects a fact entry that is not a string', () => {
    const gt = { fixtureId: 'x', facts: ['ok', 42] };
    expect(FixtureGroundTruthSchema.safeParse(gt).success).toBe(false);
  });
});
