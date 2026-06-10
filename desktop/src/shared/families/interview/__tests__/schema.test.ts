import { describe, it, expect } from 'vitest';
import { zodToGbnf } from '@shared/note-schema/zod-to-gbnf';
import { InterviewNoteSchema, type InterviewNote } from '../schema';
import fixtureJson from '../migrations/v1-fixture.json';

function validInterviewFixture(): InterviewNote {
  return {
    schemaVersion: 1,
    family: 'interview',
    title: 'fixture',
    generatedAt: '2026-05-27T00:00:00.000Z',
    generatedBy: { model: 'llama-3.2-3b-q4-km', promptVersion: 0 },
    language: 'ja',
    durationSec: 3600,
    purpose: 'fixture',
    subject_summary: 'fixture',
    qa_pairs: [],
    themes: [],
    quotable_lines: [],
    key_takeaways: [],
  };
}

describe('InterviewNoteSchema', () => {
  it('parses a minimal valid InterviewNote', () => {
    const parsed = InterviewNoteSchema.parse({
      ...validInterviewFixture(),
      title: 'プロダクトマネジャー候補者面接',
      purpose: '面接を通じて候補者の経験と思考プロセスを把握する。',
      subject_summary: '5年のPM経験を持つ候補者との1対1面接。',
      qa_pairs: [{ question: 'これまで最も困難だった意思決定を教えてください。', answer: '社内で意見が割れたローンチタイミングの判断でした。', ts: 12, asked_by: 0, answered_by: 1, from: 'transcript' as const }],
      themes: [{ name: '意思決定', appears_at_ts: [12, 405] }],
    });
    expect(parsed.family).toBe('interview');
    expect(parsed.qa_pairs).toHaveLength(1);
  });

  it('rejects when family !== "interview"', () => {
    expect(() => InterviewNoteSchema.parse({ ...validInterviewFixture(), family: 'brainstorm' })).toThrow();
  });

  it('allows asked_by === answered_by (schema-permissive; a higher-level diarization-quality contract rejects it later)', () => {
    expect(() => InterviewNoteSchema.parse({ ...validInterviewFixture(), qa_pairs: [{ question: 'Q', answer: 'A', ts: 1, asked_by: 0, answered_by: 0, from: 'transcript' as const }] })).not.toThrow();
  });

  it('accepts inherited purpose-driven fields (conclusions + next_steps)', () => {
    expect(() => InterviewNoteSchema.parse({ ...validInterviewFixture(), conclusions: [{ text: '候補者は意思決定速度に優れる', from: 'inferred' as const }], next_steps: [{ text: '2次面接スケジュール送付', owner: 0, due: '来週月曜', ts: 1800, from: 'inferred' as const }] })).not.toThrow();
  });
});

describe('InterviewNoteSchema — empty user-visible slots rejected (founder P1, 2026-06-10)', () => {
  // Mode-collapsed 3B legally filled "" into these slots because the schema
  // lacked .min(1) — the grammar emitted json-string (char*) and Zod passed.
  // .min(1) makes the grammar emit json-string-nonempty (P0a mechanism).
  it('rejects empty qa_pairs[].question', () => {
    expect(() => InterviewNoteSchema.parse({ ...validInterviewFixture(), qa_pairs: [{ question: '', answer: 'A', ts: 0, asked_by: 0, answered_by: 1, from: 'transcript' as const }] })).toThrow();
  });
  it('rejects empty qa_pairs[].answer', () => {
    expect(() => InterviewNoteSchema.parse({ ...validInterviewFixture(), qa_pairs: [{ question: 'Q', answer: '', ts: 0, asked_by: 0, answered_by: 1, from: 'transcript' as const }] })).toThrow();
  });
  it('rejects empty qa_pairs[].themes[] tag', () => {
    expect(() => InterviewNoteSchema.parse({ ...validInterviewFixture(), qa_pairs: [{ question: 'Q', answer: 'A', ts: 0, asked_by: 0, answered_by: 1, themes: [''], from: 'transcript' as const }] })).toThrow();
  });
  it('rejects empty themes[].name', () => {
    expect(() => InterviewNoteSchema.parse({ ...validInterviewFixture(), themes: [{ name: '', appears_at_ts: [0] }] })).toThrow();
  });
  it('rejects empty themes[].description when present', () => {
    expect(() => InterviewNoteSchema.parse({ ...validInterviewFixture(), themes: [{ name: 'T', description: '', appears_at_ts: [0] }] })).toThrow();
  });
  it('rejects empty quotable_lines[].text', () => {
    expect(() => InterviewNoteSchema.parse({ ...validInterviewFixture(), quotable_lines: [{ text: '', speakerRef: 0, ts: 0 }] })).toThrow();
  });
  it('rejects empty quotable_lines[].why_notable when present', () => {
    expect(() => InterviewNoteSchema.parse({ ...validInterviewFixture(), quotable_lines: [{ text: 'q', speakerRef: 0, ts: 0, why_notable: '' }] })).toThrow();
  });
  it('rejects empty key_takeaways[].text', () => {
    expect(() => InterviewNoteSchema.parse({ ...validInterviewFixture(), key_takeaways: [{ text: '', from: 'inferred' as const }] })).toThrow();
  });
  it('grammar emits json-string-nonempty for the user-visible slots', () => {
    const gbnf = zodToGbnf(InterviewNoteSchema, 'InterviewNote');
    expect(gbnf).toContain('InterviewNote-qa-pairs-elem-question ::= json-string-nonempty');
    expect(gbnf).toContain('InterviewNote-qa-pairs-elem-answer ::= json-string-nonempty');
    expect(gbnf).toContain('InterviewNote-themes-elem-name ::= json-string-nonempty');
    expect(gbnf).toContain('InterviewNote-quotable-lines-elem-text ::= json-string-nonempty');
    expect(gbnf).toContain('InterviewNote-key-takeaways-elem-text ::= json-string-nonempty');
  });
});

describe('InterviewNoteSchema — v1-fixture roundtrip', () => {
  it('parses the v1 migration fixture without throwing', () => {
    expect(() => InterviewNoteSchema.parse(fixtureJson)).not.toThrow();
  });
});

describe('InterviewNoteSchema — Path G budget locks (fail loud if a future PR widens a bound)', () => {
  it('participants max is 8', () => {
    const mk = (n: number) => ({ ...validInterviewFixture(), participants: Array.from({ length: n }, () => ({ speakerRef: 0, role: 'interviewer' as const })) });
    expect(() => InterviewNoteSchema.parse(mk(8))).not.toThrow();
    expect(() => InterviewNoteSchema.parse(mk(9))).toThrow();
  });
  it('qa_pairs max is 80', () => {
    const mk = (n: number) => ({ ...validInterviewFixture(), qa_pairs: Array.from({ length: n }, (_, i) => ({ question: 'Q', answer: 'A', ts: i, asked_by: 0, answered_by: 1, from: 'transcript' as const })) });
    expect(() => InterviewNoteSchema.parse(mk(80))).not.toThrow();
    expect(() => InterviewNoteSchema.parse(mk(81))).toThrow();
  });
  it('themes max is 12', () => {
    const mk = (n: number) => ({ ...validInterviewFixture(), themes: Array.from({ length: n }, (_, i) => ({ name: `T${i}`, appears_at_ts: [i] })) });
    expect(() => InterviewNoteSchema.parse(mk(12))).not.toThrow();
    expect(() => InterviewNoteSchema.parse(mk(13))).toThrow();
  });
  it('quotable_lines max is 20', () => {
    const mk = (n: number) => ({ ...validInterviewFixture(), quotable_lines: Array.from({ length: n }, (_, i) => ({ text: 'q', speakerRef: 0, ts: i })) });
    expect(() => InterviewNoteSchema.parse(mk(20))).not.toThrow();
    expect(() => InterviewNoteSchema.parse(mk(21))).toThrow();
  });
  it('themes[].appears_at_ts max is 20', () => {
    const mk = (n: number) => ({ ...validInterviewFixture(), themes: [{ name: 'T', appears_at_ts: Array.from({ length: n }, (_, i) => i) }] });
    expect(() => InterviewNoteSchema.parse(mk(20))).not.toThrow();
    expect(() => InterviewNoteSchema.parse(mk(21))).toThrow();
  });
  it('key_takeaways max is 15', () => {
    const mk = (n: number) => ({ ...validInterviewFixture(), key_takeaways: Array.from({ length: n }, () => ({ text: 't', from: 'inferred' as const })) });
    expect(() => InterviewNoteSchema.parse(mk(15))).not.toThrow();
    expect(() => InterviewNoteSchema.parse(mk(16))).toThrow();
  });
});
