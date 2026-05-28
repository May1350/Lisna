import { describe, it, expect } from 'vitest';
import { MeetingNoteSchema } from '../schema';

const minimal = {
  schemaVersion: 1,
  family: 'meeting',
  title: '週次計画ミーティング',
  generatedAt: '2026-05-27T12:00:00.000Z',
  generatedBy: { model: 'Llama-3.2-3B-Q4_K_M', promptVersion: 1 },
  language: 'ja',
  durationSec: 1800,
  purpose: '次週のスプリント計画',
  executive_summary: '佐藤と田中で議論しA・Bの2タスクで合意。',
  topic_arc: [],
  discussions: [],
  decisions: [],
  open_questions: [],
};

describe('MeetingNoteSchema', () => {
  it('parses a minimal valid meeting note', () => {
    expect(() => MeetingNoteSchema.parse(minimal)).not.toThrow();
  });

  it('rejects wrong family discriminator', () => {
    expect(() =>
      MeetingNoteSchema.parse({ ...minimal, family: 'lecture' }),
    ).toThrow();
  });

  it('enforces MAX_DECISIONS (21 items throws)', () => {
    const validDecision = { text: 'x', ts: 1, from: 'transcript' };
    expect(() =>
      MeetingNoteSchema.parse({
        ...minimal,
        decisions: Array.from({ length: 21 }, () => ({ ...validDecision })),
      }),
    ).toThrow();
  });

  it('enforces MAX_NEXT_STEPS (31 items throws)', () => {
    const validNextStep = { text: 'x', ts: 1, from: 'transcript' };
    expect(() =>
      MeetingNoteSchema.parse({
        ...minimal,
        next_steps: Array.from({ length: 31 }, () => ({ ...validNextStep })),
      }),
    ).toThrow();
  });

  it('rejects invalid atmosphere enum value', () => {
    expect(() =>
      MeetingNoteSchema.parse({ ...minimal, atmosphere: 'chaotic' }),
    ).toThrow();
  });

  it('enforces SpeakerRefSchema on decisions[0].made_by', () => {
    expect(() =>
      MeetingNoteSchema.parse({
        ...minimal,
        decisions: [{ text: 'x', ts: 1, from: 'transcript', made_by: 1.5 }],
      }),
    ).toThrow();

    expect(() =>
      MeetingNoteSchema.parse({
        ...minimal,
        decisions: [{ text: 'x', ts: 1, from: 'transcript', made_by: 0 }],
      }),
    ).not.toThrow();
  });

  it('accepts from: transcript and rejects unknown top-level keys (.strict())', () => {
    // Valid decision with from: 'transcript' should parse
    expect(() =>
      MeetingNoteSchema.parse({
        ...minimal,
        decisions: [{ text: 'decision text', ts: 42, from: 'transcript' }],
      }),
    ).not.toThrow();

    // .strict() rejects unknown top-level keys
    expect(() =>
      MeetingNoteSchema.parse({ ...minimal, foo: 1 }),
    ).toThrow();
  });
});
