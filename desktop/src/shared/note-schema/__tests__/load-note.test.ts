import { describe, it, expect, beforeAll } from 'vitest';
import { loadNote } from '../load-note';
import { ForwardIncompatNoteError } from '../forward-incompat';
import fixtureJson from '../../families/lecture/migrations/v1-fixture.json';

// Side-effect import seeds the familyCoreRegistry with LectureFamilyCore.
// Same pattern as pipeline.test.ts and orchestrator tests.
beforeAll(async () => {
  await import('../../families/lecture/core');
});

const FIXTURE_STR = JSON.stringify(fixtureJson);

describe('loadNote', () => {
  it('1. loads a v1 Lecture fixture without throwing', () => {
    expect(() => loadNote(FIXTURE_STR)).not.toThrow();
  });

  it('2. throws ForwardIncompatNoteError on schemaVersion: 999', () => {
    const mutated = JSON.stringify({ ...fixtureJson, schemaVersion: 999 });
    expect(() => loadNote(mutated)).toThrow(ForwardIncompatNoteError);
  });

  it('3. returns a note with family === "lecture"', () => {
    const note = loadNote(FIXTURE_STR) as { family: string };
    expect(note.family).toBe('lecture');
  });

  it('4. empty migrations array is a no-op — runner completes for v1 note', () => {
    // Lecture has zero migrations. The while-loop body never executes for a
    // v1 note (currentV === CURRENT_SCHEMA_VERSION at loop entry → skip).
    // Assert: load succeeds and result is defined.
    const note = loadNote(FIXTURE_STR);
    expect(note).toBeDefined();
    expect(note.schemaVersion).toBe(1);
  });

  it('5. throws UNKNOWN_FAMILY:<value> for unrecognized family', () => {
    const bad = JSON.stringify({
      schemaVersion: 1,
      family: 'unsupported',
      title: 'x',
      generatedAt: '2026-05-27T00:00:00.000Z',
      generatedBy: { model: 'm', promptVersion: 1 },
      language: 'en',
      durationSec: 0,
      sections: [],
    });
    expect(() => loadNote(bad)).toThrow('UNKNOWN_FAMILY:unsupported');
  });

  it('6a. throws INVALID_SCHEMA_VERSION when schemaVersion is absent', () => {
    const noVersion = JSON.stringify({
      family: 'lecture',
      title: 'x',
      generatedAt: '2026-05-27T00:00:00.000Z',
      generatedBy: { model: 'm', promptVersion: 1 },
      language: 'en',
      durationSec: 0,
      sections: [],
    });
    expect(() => loadNote(noVersion)).toThrow('INVALID_SCHEMA_VERSION');
  });

  it('6b. throws INVALID_SCHEMA_VERSION when schemaVersion is negative', () => {
    const negVersion = JSON.stringify({ ...fixtureJson, schemaVersion: -1 });
    expect(() => loadNote(negVersion)).toThrow('INVALID_SCHEMA_VERSION');
  });

  it('6c. throws INVALID_SCHEMA_VERSION when schemaVersion is zero', () => {
    const zeroVersion = JSON.stringify({ ...fixtureJson, schemaVersion: 0 });
    expect(() => loadNote(zeroVersion)).toThrow('INVALID_SCHEMA_VERSION');
  });

  it('7. throws MISSING_FAMILY when family field is absent', () => {
    const noFamily = JSON.stringify({
      schemaVersion: 1,
      title: 'x',
      generatedAt: '2026-05-27T00:00:00.000Z',
      generatedBy: { model: 'm', promptVersion: 1 },
      language: 'en',
      durationSec: 0,
      sections: [],
    });
    expect(() => loadNote(noFamily)).toThrow('MISSING_FAMILY');
  });

  it('8. throws INVALID_NOTE_SHAPE on JSON.parse returning null / array / primitive', () => {
    expect(() => loadNote('null')).toThrow('INVALID_NOTE_SHAPE');
    expect(() => loadNote('[]')).toThrow('INVALID_NOTE_SHAPE');
    expect(() => loadNote('"hello"')).toThrow('INVALID_NOTE_SHAPE');
    expect(() => loadNote('42')).toThrow('INVALID_NOTE_SHAPE');
  });

  it('9. lets JSON.parse SyntaxError propagate (caller distinguishes malformed JSON)', () => {
    expect(() => loadNote('this is not json {')).toThrow(SyntaxError);
  });
});
