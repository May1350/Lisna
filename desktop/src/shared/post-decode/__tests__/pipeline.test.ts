import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { runPostDecodePipeline } from '../pipeline';
import { LectureFamilyCore } from '../../families/lecture/core';
import { InterviewFamilyCore } from '../../families/interview/core';
import { ProvenanceSchema, NoteBaseSchema } from '../../note-schema';
import type { FamilyCoreDefinition } from '../../families';
import type { NoteBase } from '../../note-schema/base';
import type { SessionTranscript } from '../../note-schema/transcript';

// Minimal valid LectureNote JSON (schemaVersion=1)
function makeLectureRaw(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: 1,
    family: 'lecture',
    title: 'Test Lecture',
    generatedAt: '2026-05-27T00:00:00.000Z',
    generatedBy: { model: 'test-model', promptVersion: 1 },
    language: 'ja',
    durationSec: 120,
    sections: [],
    ...overrides,
  });
}

// Minimal transcript with one segment at ts=5
const TRANSCRIPT_WITH_TS5: SessionTranscript = {
  sessionId: 'test-session',
  speakers: [{ id: 0 }],
  transcriptSegments: [
    { ts: 5, endTs: 8, text: 'x y z', speakerId: 0 },
  ],
};

const EMPTY_TRANSCRIPT: SessionTranscript = {
  sessionId: 'test-session',
  speakers: [],
  transcriptSegments: [],
};

describe('runPostDecodePipeline (Lecture)', () => {
  it('Stage 1: parses raw JSON and returns a validated note', () => {
    const raw = makeLectureRaw();
    const note = runPostDecodePipeline(raw, LectureFamilyCore, EMPTY_TRANSCRIPT) as {
      family: string;
      schemaVersion: number;
    };
    expect(note.family).toBe('lecture');
    expect(note.schemaVersion).toBe(1);
  });

  it('Stage 2: no-op for Lecture (fill-ids stage skipped)', () => {
    // For Lecture the id-fill stage does nothing. We verify the pipeline
    // still succeeds and does not mutate any field unexpectedly.
    const raw = makeLectureRaw({
      sections: [{
        heading: 'Section A',
        ts: 0,
        summary: 'A summary',
        key_terms: [],
        examples: [],
        points: [],
      }],
    });
    const note = runPostDecodePipeline(raw, LectureFamilyCore, EMPTY_TRANSCRIPT) as {
      sections: Array<{ heading: string }>;
    };
    expect(note.sections[0]!.heading).toBe('Section A');
  });

  it('Stage 3: fills `from` via computeProvenance for key_term leaf with ts matching transcript', () => {
    const raw = makeLectureRaw({
      sections: [{
        heading: 'h',
        ts: 0,
        summary: 'summary text',
        key_terms: [{
          term: 'x',
          definition: 'definition of x',
          ts: 5,
          // `from` intentionally absent — pipeline should fill it
        }],
        examples: [],
        points: [],
      }],
    });
    const note = runPostDecodePipeline(
      raw,
      LectureFamilyCore,
      TRANSCRIPT_WITH_TS5,
    ) as {
      sections: Array<{
        key_terms: Array<{ term: string; from: string }>;
      }>;
    };
    // ts=5 aligns with segment at ts=5 (within default ±3s window)
    expect(note.sections[0]!.key_terms[0]!.from).toBe('transcript');
  });

  it('Stage 3: fills `from` as inferred when ts does not match any transcript segment', () => {
    const raw = makeLectureRaw({
      sections: [{
        heading: 'h',
        ts: 0,
        summary: 'summary text',
        key_terms: [{
          term: 'y',
          definition: 'definition of y',
          ts: 100,  // far from segment at ts=5
        }],
        examples: [],
        points: [],
      }],
    });
    const note = runPostDecodePipeline(
      raw,
      LectureFamilyCore,
      TRANSCRIPT_WITH_TS5,
    ) as {
      sections: Array<{
        key_terms: Array<{ from: string }>;
      }>;
    };
    expect(note.sections[0]!.key_terms[0]!.from).toBe('inferred');
  });

  it('Stage 4: Zod parse accepts a valid filled note (Lecture has no SpeakerRef → closure is a no-op for this family)', () => {
    const raw = makeLectureRaw({
      sections: [{
        heading: 'Valid Section',
        ts: 2,
        summary: 'some summary',
        key_terms: [{
          term: 'alpha',
          definition: 'a greek letter',
          ts: 2,
          // pipeline fills `from`
        }],
        examples: [{
          text: 'an example',
          ts: 3,
          // pipeline fills `from`
        }],
        points: [{
          text: 'a point',
          ts: 4,
          important: false,
          // pipeline fills `from`
        }],
      }],
    });
    const note = runPostDecodePipeline(
      raw,
      LectureFamilyCore,
      TRANSCRIPT_WITH_TS5,
    ) as {
      sections: Array<{
        key_terms: Array<{ from: string }>;
        examples: Array<{ from: string }>;
        points: Array<{ from: string }>;
      }>;
    };
    // All `from` fields were filled by pipeline before Zod parse.
    // key_term ts=2, segment at ts=5 → abs diff=3, within ±3s window (<=) → 'transcript'
    expect(note.sections[0]!.key_terms[0]!.from).toBe('transcript');
    expect(note.sections[0]!.examples[0]!.from).toBeDefined();
    expect(note.sections[0]!.points[0]!.from).toBeDefined();
  });

  it('Stage 5: Lecture is no-op for per-chunk dedup (input not mutated unexpectedly)', () => {
    // Lecture dedup is field-level inside MergeStrategy at the merge stage.
    // Per-chunk dedup must not alter the note shape.
    const raw = makeLectureRaw({
      sections: [{
        heading: 'h',
        ts: 0,
        summary: 'summary text',
        key_terms: [
          { term: 'dup', definition: 'def1', ts: 5 },
          { term: 'dup', definition: 'def1', ts: 5 },
        ],
        examples: [],
        points: [],
      }],
    });
    const note = runPostDecodePipeline(
      raw,
      LectureFamilyCore,
      TRANSCRIPT_WITH_TS5,
    ) as {
      sections: Array<{
        key_terms: Array<{ term: string }>;
      }>;
    };
    // Lecture stage 5 is a no-op — duplicates are NOT removed per chunk
    expect(note.sections[0]!.key_terms).toHaveLength(2);
  });

  // schemaVersion is SYSTEM-owned. The grammar exposes NoteBase.schemaVersion
  // as a free positive int (`z.number().int().positive()`), so a real LLM can
  // — and does (observed: 2 in founder smoke 2026-06) — emit any value. The
  // generation path must NORMALIZE it to CURRENT, not reject the whole note.
  // Forward-incompat defense for *persisted* future-version notes lives in the
  // load path (load-note.ts), the only place a genuinely-newer note appears.
  it('normalizes an LLM-emitted schemaVersion above CURRENT to CURRENT', () => {
    const raw = makeLectureRaw({ schemaVersion: 2 });
    const note = runPostDecodePipeline(raw, LectureFamilyCore, EMPTY_TRANSCRIPT) as {
      schemaVersion: number;
    };
    expect(note.schemaVersion).toBe(1);
  });

  it('normalizes an extreme LLM-emitted schemaVersion to CURRENT', () => {
    const raw = makeLectureRaw({ schemaVersion: 99 });
    const note = runPostDecodePipeline(raw, LectureFamilyCore, EMPTY_TRANSCRIPT) as {
      schemaVersion: number;
    };
    expect(note.schemaVersion).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Stage 3 — ts-less leaves (meeting conclusions pattern)
// ---------------------------------------------------------------------------

/**
 * Minimal fake family for testing provenance fill on ts-optional leaves.
 * Uses 'lecture' as the family id so Stage 2 (brainstorm id-fill) is a
 * no-op. Schema is a small z.object that mirrors the meeting conclusions
 * shape: text (required), ts (optional), from (required ProvenanceSchema).
 */
const fakeItemSchema = z.object({
  text: z.string().min(1),
  ts: z.number().nonnegative().optional(),
  from: ProvenanceSchema,
});

const fakeFamilySchema = NoteBaseSchema.extend({
  family: z.literal('lecture'),
  items: z.array(fakeItemSchema),
}).strict();

const fakeFamilyCore = {
  id: 'lecture',
  schema: fakeFamilySchema,
  prompts: [],
  defaultPromptVariant: 'default',
  picker: { labelKey: '', iconPath: '', descriptionKey: '', visibility: 'experimental' },
  evalBaselines: [],
  requiresDiarization: false,
  mergeStrategy: { scalarPolicy: 'first', arrayPolicy: 'concat-dedup' },
} as unknown as FamilyCoreDefinition<NoteBase>;

function makeFakeRaw(items: Array<{ text: string; ts?: number }>): string {
  return JSON.stringify({
    schemaVersion: 1,
    family: 'lecture',
    title: 'Test',
    generatedAt: '2026-05-28T00:00:00.000Z',
    generatedBy: { model: 'test', promptVersion: 1 },
    language: 'ja',
    durationSec: 60,
    items,
  });
}

describe('Stage 3 — provenance fill on ts-less leaves (meeting conclusions pattern)', () => {
  it('FAIL-FIRST: ts-absent leaf gets from=inferred (currently fails due to skip in pipeline)', () => {
    // Leaf has text but no ts — Stage 3 currently skips it →
    // Zod parse fails because from is required but missing.
    const raw = makeFakeRaw([{ text: 'a conclusion without ts' }]);
    const note = runPostDecodePipeline(raw, fakeFamilyCore, EMPTY_TRANSCRIPT) as {
      items: Array<{ text: string; from: string }>;
    };
    expect(note.items[0]!.from).toBe('inferred');
  });

  it('leaf WITH numeric ts matching transcript segment gets from=transcript', () => {
    const raw = makeFakeRaw([{ text: 'conclusion with ts', ts: 5 }]);
    const note = runPostDecodePipeline(
      raw,
      fakeFamilyCore,
      TRANSCRIPT_WITH_TS5,
    ) as { items: Array<{ from: string }> };
    // ts=5 matches the segment at ts=5 (within ±3s window)
    expect(note.items[0]!.from).toBe('transcript');
  });

  it('leaf WITH numeric ts that does NOT match any segment gets from=inferred', () => {
    const raw = makeFakeRaw([{ text: 'conclusion far from transcript', ts: 999 }]);
    const note = runPostDecodePipeline(
      raw,
      fakeFamilyCore,
      TRANSCRIPT_WITH_TS5,
    ) as { items: Array<{ from: string }> };
    expect(note.items[0]!.from).toBe('inferred');
  });
});

// ---------------------------------------------------------------------------
// Stage 3 — qa_pairs leaves (Interview): discriminated by question+answer,
// NOT text/term/expression. Without the qa_pair discriminator, Stage 3 skips
// these leaves and Stage 4 Zod parse throws (qa_pairs[].from is required).
// ---------------------------------------------------------------------------

// Minimal valid InterviewNote JSON. qa_pairs intentionally omit `from` — the
// pipeline must fill it via computeProvenance before Zod parse.
function makeInterviewRaw(qaPairs: Array<Record<string, unknown>>): string {
  return JSON.stringify({
    schemaVersion: 1,
    family: 'interview',
    title: 'Test Interview',
    generatedAt: '2026-05-29T00:00:00.000Z',
    generatedBy: { model: 'test-model', promptVersion: 1 },
    language: 'ja',
    durationSec: 120,
    purpose: 'test purpose',
    subject_summary: 'a subject summary',
    qa_pairs: qaPairs,
    themes: [],
    quotable_lines: [],
    key_takeaways: [],
  });
}

describe('Stage 3 — provenance fill on qa_pairs (Interview)', () => {
  it('FAIL-FIRST: qa_pair (question+answer, no from) is filled so the note validates; ts match → transcript', () => {
    // qa_pairs carry question/answer (not text/term/expression). Before the
    // qa_pair discriminator, Stage 3 skips them → from stays undefined → the
    // required ProvenanceSchema makes Stage 4 throw.
    const raw = makeInterviewRaw([
      { question: 'Q', answer: 'A', ts: 5, asked_by: 0, answered_by: 1 },
    ]);
    const note = runPostDecodePipeline(raw, InterviewFamilyCore, TRANSCRIPT_WITH_TS5) as {
      qa_pairs: Array<{ from: string }>;
    };
    // ts=5 aligns with the segment at ts=5 (within ±3s window)
    expect(note.qa_pairs[0]!.from).toBe('transcript');
  });

  it('qa_pair with ts far from any segment gets from=inferred', () => {
    const raw = makeInterviewRaw([
      { question: 'Q', answer: 'A', ts: 999, asked_by: 0, answered_by: 1 },
    ]);
    const note = runPostDecodePipeline(raw, InterviewFamilyCore, TRANSCRIPT_WITH_TS5) as {
      qa_pairs: Array<{ from: string }>;
    };
    expect(note.qa_pairs[0]!.from).toBe('inferred');
  });
});
