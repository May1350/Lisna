import { describe, it, expect, beforeAll } from 'vitest';
import { loadNote } from '../load-note';
import { ForwardIncompatNoteError } from '../forward-incompat';
import fixtureJson from '../../families/lecture/migrations/v1-fixture.json';
import meetingFixtureJson from '../../families/meeting/migrations/v1-fixture.json';
import interviewFixtureJson from '../../families/interview/migrations/v1-fixture.json';
import brainstormFixtureJson from '../../families/brainstorm/migrations/v1-fixture.json';

// Side-effect imports seed the familyCoreRegistry.
// Same pattern as pipeline.test.ts and orchestrator tests.
beforeAll(async () => {
  await import('../../families/lecture/core');
  await import('../../families/meeting/core');
  await import('../../families/interview/core');
  await import('../../families/brainstorm/core');
});

const FIXTURE_STR = JSON.stringify(fixtureJson);
const MEETING_FIXTURE_STR = JSON.stringify(meetingFixtureJson);
const INTERVIEW_FIXTURE_STR = JSON.stringify(interviewFixtureJson);
const BRAINSTORM_FIXTURE_STR = JSON.stringify(brainstormFixtureJson);

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

  // Meeting family dispatch — mirrors lecture cases above.
  it('10. loads a v1 Meeting fixture without throwing', () => {
    expect(() => loadNote(MEETING_FIXTURE_STR)).not.toThrow();
  });

  it('11. returns a note with family === "meeting"', () => {
    const note = loadNote(MEETING_FIXTURE_STR) as { family: string };
    expect(note.family).toBe('meeting');
  });

  it('12. meeting fixture: title and decisions length are as expected', () => {
    const note = loadNote(MEETING_FIXTURE_STR) as unknown as {
      family: string;
      title: string;
      decisions: unknown[];
    };
    expect(note.title).toBe('スプリント計画ミーティング — 2026-05-28');
    expect(note.decisions).toHaveLength(3);
  });

  it('13. meeting: empty migrations array is a no-op — schemaVersion 1 loads as-is', () => {
    const note = loadNote(MEETING_FIXTURE_STR);
    expect(note.schemaVersion).toBe(1);
  });

  it('14. throws ForwardIncompatNoteError on schemaVersion: 2 for meeting (future version)', () => {
    const mutated = JSON.stringify({ ...meetingFixtureJson, schemaVersion: 2 });
    expect(() => loadNote(mutated)).toThrow(ForwardIncompatNoteError);
  });

  // Interview family dispatch — mirrors meeting cases above.
  it('15. loads a v1 Interview fixture without throwing', () => {
    expect(() => loadNote(INTERVIEW_FIXTURE_STR)).not.toThrow();
  });

  it('16. returns a note with family === "interview"', () => {
    const note = loadNote(INTERVIEW_FIXTURE_STR) as { family: string };
    expect(note.family).toBe('interview');
  });

  it('17. interview: empty migrations array is a no-op — schemaVersion 1 loads as-is', () => {
    const note = loadNote(INTERVIEW_FIXTURE_STR);
    expect(note.schemaVersion).toBe(1);
  });

  it('18. throws ForwardIncompatNoteError on schemaVersion: 2 for interview (future version)', () => {
    const mutated = JSON.stringify({ ...interviewFixtureJson, schemaVersion: 2 });
    expect(() => loadNote(mutated)).toThrow(ForwardIncompatNoteError);
  });

  // Brainstorm family dispatch — mirrors meeting cases above.
  it('19. loads a v1 Brainstorm fixture without throwing', () => {
    expect(() => loadNote(BRAINSTORM_FIXTURE_STR)).not.toThrow();
  });

  it('20. returns a note with family === "brainstorm"', () => {
    const note = loadNote(BRAINSTORM_FIXTURE_STR) as { family: string };
    expect(note.family).toBe('brainstorm');
  });

  it('21. brainstorm: empty migrations array is a no-op — schemaVersion 1 loads as-is', () => {
    const note = loadNote(BRAINSTORM_FIXTURE_STR);
    expect(note.schemaVersion).toBe(1);
  });

  it('22. throws ForwardIncompatNoteError on schemaVersion: 2 for brainstorm (future version)', () => {
    const mutated = JSON.stringify({ ...brainstormFixtureJson, schemaVersion: 2 });
    expect(() => loadNote(mutated)).toThrow(ForwardIncompatNoteError);
  });
});
