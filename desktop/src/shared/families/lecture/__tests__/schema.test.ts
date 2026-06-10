import { describe, it, expect } from 'vitest';
import { LectureNoteSchema } from '../schema';

describe('LectureNoteSchema', () => {
  it('parses a minimal valid lecture note', () => {
    const minimal = {
      schemaVersion: 1,
      family: 'lecture',
      title: '電磁ポテンシャル入門',
      generatedAt: '2026-05-27T12:00:00.000Z',
      generatedBy: { model: 'Llama-3.2-3B-Q4_K_M', promptVersion: 1 },
      language: 'ja',
      durationSec: 3220,
      sections: [
        {
          heading: '導入',
          ts: 0,
          summary: '静電ポテンシャルの定義',
          key_terms: [],
          examples: [],
          points: [],
        },
      ],
    };
    expect(() => LectureNoteSchema.parse(minimal)).not.toThrow();
  });

  it('rejects notes missing required NoteBase fields', () => {
    expect(() => LectureNoteSchema.parse({ family: 'lecture' })).toThrow();
  });

  // Same empty-slot class as the interview founder P1 (2026-06-10). P0a added
  // .min(1) to heading/term/examples/points but left summary + definition open.
  it('rejects empty sections[].summary', () => {
    expect(() => LectureNoteSchema.parse({
      schemaVersion: 1, family: 'lecture', title: 't',
      generatedAt: '2026-05-27T12:00:00.000Z',
      generatedBy: { model: 'm', promptVersion: 1 },
      language: 'ja', durationSec: 1,
      sections: [{ heading: 'h', ts: 0, summary: '', key_terms: [], examples: [], points: [] }],
    })).toThrow();
  });

  it('rejects empty optional user-visible strings when present (takeaway/tldr/course/lecturer)', () => {
    const base = {
      schemaVersion: 1, family: 'lecture', title: 't',
      generatedAt: '2026-05-27T12:00:00.000Z',
      generatedBy: { model: 'm', promptVersion: 1 },
      language: 'ja', durationSec: 1,
      sections: [{ heading: 'h', ts: 0, summary: 's', key_terms: [], examples: [], points: [] }],
    };
    expect(() => LectureNoteSchema.parse({ ...base, tldr: '' })).toThrow();
    expect(() => LectureNoteSchema.parse({ ...base, course: '' })).toThrow();
    expect(() => LectureNoteSchema.parse({ ...base, lecturer: '' })).toThrow();
    expect(() => LectureNoteSchema.parse({
      ...base,
      sections: [{ heading: 'h', ts: 0, summary: 's', takeaway: '', key_terms: [], examples: [], points: [] }],
    })).toThrow();
  });

  it('rejects empty key_terms[].definition', () => {
    expect(() => LectureNoteSchema.parse({
      schemaVersion: 1, family: 'lecture', title: 't',
      generatedAt: '2026-05-27T12:00:00.000Z',
      generatedBy: { model: 'm', promptVersion: 1 },
      language: 'ja', durationSec: 1,
      sections: [{
        heading: 'h', ts: 0, summary: 's',
        key_terms: [{ term: 'x', definition: '', ts: 0, from: 'transcript' }],
        examples: [], points: [],
      }],
    })).toThrow();
  });

  it('rejects wrong family discriminator', () => {
    expect(() => LectureNoteSchema.parse({
      schemaVersion: 1, family: 'meeting', title: 't',
      generatedAt: '2026-05-27T12:00:00.000Z',
      generatedBy: { model: 'm', promptVersion: 1 },
      language: 'ja', durationSec: 1, sections: [],
    })).toThrow();
  });

  it('enforces .max(10) on sections array (Path G)', () => {
    const tooManySections = {
      schemaVersion: 1, family: 'lecture', title: 't',
      generatedAt: '2026-05-27T12:00:00.000Z',
      generatedBy: { model: 'm', promptVersion: 1 },
      language: 'ja', durationSec: 1,
      sections: Array.from({ length: 11 }, (_, i) => ({
        heading: `s${i}`, ts: i, summary: 's',
        key_terms: [], examples: [], points: [],
      })),
    };
    expect(() => LectureNoteSchema.parse(tooManySections)).toThrow(/sections/i);
  });

  it('enforces .max(12) on key_terms per section (Path G)', () => {
    const baseSection = {
      heading: 'h', ts: 0, summary: 's', examples: [], points: [],
      key_terms: Array.from({ length: 13 }, (_, i) => ({
        term: `t${i}`, definition: 'd', ts: i, from: 'transcript',
      })),
    };
    expect(() => LectureNoteSchema.parse({
      schemaVersion: 1, family: 'lecture', title: 't',
      generatedAt: '2026-05-27T12:00:00.000Z',
      generatedBy: { model: 'm', promptVersion: 1 },
      language: 'ja', durationSec: 1,
      sections: [baseSection],
    })).toThrow(/key_terms/i);
  });

  it('requires from on key_terms entries (post-decode pipeline fills it)', () => {
    const noFrom = {
      schemaVersion: 1, family: 'lecture', title: 't',
      generatedAt: '2026-05-27T12:00:00.000Z',
      generatedBy: { model: 'm', promptVersion: 1 },
      language: 'ja', durationSec: 1,
      sections: [{
        heading: 'h', ts: 0, summary: 's',
        key_terms: [{ term: 'x', definition: 'y', ts: 5 }], // no `from`
        examples: [], points: [],
      }],
    };
    expect(() => LectureNoteSchema.parse(noFrom)).toThrow();
  });

  it('rejects unknown top-level fields (strict mode)', () => {
    expect(() => LectureNoteSchema.parse({
      schemaVersion: 1, family: 'lecture', title: 't',
      generatedAt: '2026-05-27T12:00:00.000Z',
      generatedBy: { model: 'm', promptVersion: 1 },
      language: 'ja', durationSec: 1, sections: [],
      bogusField: 'reject me',
    })).toThrow();
  });

  it('accepts a section with extras: [procedure_steps]', () => {
    const note = {
      schemaVersion: 1, family: 'lecture', title: 't',
      generatedAt: '2026-05-27T12:00:00.000Z',
      generatedBy: { model: 'm', promptVersion: 1 },
      language: 'ja', durationSec: 1,
      sections: [{
        heading: 'h', ts: 0, summary: 's',
        key_terms: [], examples: [], points: [],
        extras: [{
          type: 'procedure_steps',
          steps: [
            { order: 1, text: 'a', ts: 0, from: 'transcript' },
            { order: 2, text: 'b', ts: 1, from: 'transcript' },
          ],
        }],
      }],
    };
    expect(() => LectureNoteSchema.parse(note)).not.toThrow();
  });

  it('enforces .max(8) on extras per section (Path G)', () => {
    const makeStep = (i: number) => ({
      type: 'procedure_steps',
      steps: [
        { order: 1, text: `a${i}`, ts: 0, from: 'transcript' },
        { order: 2, text: `b${i}`, ts: 1, from: 'transcript' },
      ],
    });
    const note = {
      schemaVersion: 1, family: 'lecture', title: 't',
      generatedAt: '2026-05-27T12:00:00.000Z',
      generatedBy: { model: 'm', promptVersion: 1 },
      language: 'ja', durationSec: 1,
      sections: [{
        heading: 'h', ts: 0, summary: 's',
        key_terms: [], examples: [], points: [],
        extras: Array.from({ length: 9 }, (_, i) => makeStep(i)),
      }],
    };
    expect(() => LectureNoteSchema.parse(note)).toThrow(/extras/i);
  });
});
