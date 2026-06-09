import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface SaveHypFixtureInput {
  /** Fixture id under `desktop/eval/fixtures/lecture/<id>/`. */
  fixtureId: string;
  /** Whole STT hypothesis text, written as a single utterance at ts=0. */
  hyp: string;
  /** Reference text (used for `meta.notes` traceability — not asserted). */
  reference: string;
  /** Clip length the recording covers. Becomes `durationSec` + `bucketSeconds`. */
  durationSec: number;
  /** STT model id whose hyp this is — kept in `meta.notes` for audit. */
  sttModelId: string;
  /** Absolute path of `desktop/eval/fixtures` so the writer is testable. */
  fixturesRoot: string;
}

export interface SaveHypFixtureResult {
  dir: string;
  metaPath: string;
  transcriptPath: string;
}

/**
 * Materialise a Task 9 composed-gate fixture: a single lecture-family
 * utterance carrying the real-STT hypothesis text. The downstream LLM
 * note pipeline (`eval:notes --family lecture --fixture <id>`) then runs
 * 3B against this transcript, producing the `v0-3b-lecture-realstt`
 * baseline — the measured track-exit gate (spec 4c).
 */
export function saveHypAsLectureFixture(input: SaveHypFixtureInput): SaveHypFixtureResult {
  const dir = join(input.fixturesRoot, 'lecture', input.fixtureId);
  mkdirSync(dir, { recursive: true });
  const meta = {
    fixtureId: input.fixtureId,
    family: 'lecture' as const,
    language: 'ja' as const,
    durationSec: input.durationSec,
    bucketSeconds: input.durationSec,
    scenarioTags: ['realstt', 'composed-gate'],
    expectedSlots: [],
    sourceUrl: null,
    notes: `Composed-gate fixture: ${input.sttModelId} far-field-real hyp of ja-30s reference (${[...input.reference].length} chars).`,
  };
  const transcript = {
    sessionId: input.fixtureId,
    speakers: [{ id: 0 }],
    bucket_seconds: input.durationSec,
    transcripts: [
      { ts: 0, text: input.hyp, speakerId: 0 },
    ],
  };
  const metaPath = join(dir, 'meta.json');
  const transcriptPath = join(dir, 'transcript.json');
  writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf8');
  writeFileSync(transcriptPath, JSON.stringify(transcript, null, 2) + '\n', 'utf8');
  return { dir, metaPath, transcriptPath };
}
