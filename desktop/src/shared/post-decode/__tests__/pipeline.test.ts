import { describe, it, expect } from 'vitest';
import { runPostDecodePipeline, ForwardIncompatNoteError } from '../pipeline';
import { LectureFamilyCore } from '../../families/lecture/core';
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

  it('throws ForwardIncompatNoteError when schemaVersion > CURRENT_SCHEMA_VERSION', () => {
    const raw = makeLectureRaw({ schemaVersion: 99 });
    expect(() =>
      runPostDecodePipeline(raw, LectureFamilyCore, EMPTY_TRANSCRIPT),
    ).toThrow(ForwardIncompatNoteError);
  });
});
