/**
 * Tests for finalizeMeeting (Task 6).
 * Uses an inline mockSidecar — mirrors lecture-orchestrator.test.ts pattern.
 *
 * Four test cases:
 *   1. happy path: multi-speaker transcript (status 'ok') → note with family='meeting'
 *   2. diarization fallback: status 'disabled' → validation_warnings includes SINGLE_SPEAKER_WARNING
 *   3. speaker-map injection: prompt contains 'Speaker map:' and '[Name]' prefixes
 *   4. empty transcript → throws EMPTY_TRANSCRIPT
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { finalizeMeeting, type FinalizeMeetingArgs } from '../orchestrator';
import type { GrammarCapableSidecar } from '../grammar-call';
import type { SessionTranscript } from '@shared/note-schema/transcript';
import { modelProfiles } from '@shared/models/profiles';
import type { ModelProfile } from '@shared/models/profiles';
import { SINGLE_SPEAKER_WARNING } from '@shared/families/meeting/degrade-to-single-speaker';

// ─── inline mock sidecar ────────────────────────────────────────────────────

type MockOpts = {
  responses?: string[];
  failuresPerCall?: Record<number, number>;
};

function mockSidecar(
  opts: MockOpts = {},
): GrammarCapableSidecar & { calls: Array<{ prompt: string; grammar: string; seed: number }> } {
  const responses = opts.responses;
  const failures = opts.failuresPerCall ?? {};
  const calls: Array<{ prompt: string; grammar: string; seed: number }> = [];
  let successCallIdx = 0;
  return {
    calls,
    async generateWithGrammar(req) {
      calls.push({ prompt: req.prompt, grammar: req.grammar, seed: req.seed });
      if (failures[successCallIdx] && failures[successCallIdx]! > 0) {
        failures[successCallIdx]!--;
        throw new Error('mock-fail');
      }
      const text = responses ? (responses[successCallIdx] ?? '{}') : makeMeetingNoteJson(0);
      successCallIdx++;
      return { text, seed: req.seed };
    },
  };
}

// ─── fixtures ────────────────────────────────────────────────────────────────

/**
 * Build a minimal valid MeetingNote JSON string.
 *
 * Pipeline Stage 3 fills `from` on provenance-bearing leaves (decisions,
 * proposals, next_steps, open_questions, etc.), so we MUST NOT include `from`
 * in the raw JSON — the pipeline inserts it post-hoc via computeProvenance.
 *
 * Required fields per MeetingNoteSchema (all others optional):
 *   NoteBase: schemaVersion, family, title, generatedAt, generatedBy, language, durationSec
 *   Meeting:  purpose, executive_summary, topic_arc (array), discussions (array),
 *             decisions (array), open_questions (array)
 */
function makeMeetingNoteJson(ts: number): string {
  return JSON.stringify({
    schemaVersion: 1,
    family: 'meeting',
    title: 'テスト会議',
    generatedAt: new Date().toISOString(),
    generatedBy: { model: 'llama-3.2-3b-q4-km', promptVersion: 1 },
    language: 'ja',
    durationSec: 60,
    purpose: 'プロジェクトの進捗確認',
    executive_summary: 'プロジェクトは順調に進んでいます。',
    topic_arc: [
      {
        topic: 'プロジェクト進捗',
        ts,
        speakers_involved: [],
      },
    ],
    discussions: [
      {
        topic: '進捗報告',
        ts_start: ts,
        summary: '各チームから進捗報告がありました。',
      },
    ],
    decisions: [],
    open_questions: [],
  });
}

/**
 * Build a SessionTranscript with named speakers and multi-speaker segments.
 * Used for the happy-path and speaker-map tests.
 */
function makeMultiSpeakerTranscript(): SessionTranscript {
  return {
    sessionId: 'test-meeting',
    speakers: [
      { id: 0, name: '佐藤' },
      { id: 1, name: '山田' },
    ],
    transcriptSegments: [
      { ts: 0, endTs: 5, text: 'よろしくお願いします。', speakerId: 0 },
      { ts: 5, endTs: 10, text: 'こちらこそよろしくお願いします。', speakerId: 1 },
      { ts: 10, endTs: 15, text: '進捗について報告します。', speakerId: 0 },
    ],
  };
}

/**
 * Build a single-speaker transcript (simulates the alpha path where
 * adaptToV2Transcript assigns all speakerId=0).
 */
function makeSingleSpeakerTranscript(): SessionTranscript {
  return {
    sessionId: 'test-meeting',
    speakers: [{ id: 0 }],
    transcriptSegments: [
      { ts: 0, endTs: 5, text: 'よろしくお願いします。', speakerId: 0 },
      { ts: 5, endTs: 10, text: '進捗を報告します。', speakerId: 0 },
    ],
  };
}

/**
 * Override recommendedChunkTokens on the meeting profile to force
 * multi-chunk behavior in tests that need it.
 */
function profileWithChunkBudget(budget: number): ModelProfile {
  const base = modelProfiles['llama-3.2-3b-q4-km']!;
  return {
    ...base,
    perFamily: {
      ...base.perFamily,
      meeting: { ...base.perFamily['meeting']!, recommendedChunkTokens: budget },
    },
  };
}

// Register meeting family once before all tests
beforeAll(async () => {
  await import('@shared/families/meeting/core');
});

const modelProfile = modelProfiles['llama-3.2-3b-q4-km']!;

// ─── tests ───────────────────────────────────────────────────────────────────

describe('finalizeMeeting', () => {
  it('happy path: multi-speaker transcript (ok) → note has family=meeting, schema validates', async () => {
    const response = makeMeetingNoteJson(0);
    const sidecar = mockSidecar({ responses: [response] });
    const transcript = makeMultiSpeakerTranscript();

    const args: FinalizeMeetingArgs = {
      sessionId: 'test',
      transcript,
      sidecar,
      modelProfile,
      diarizationStatus: 'ok',
    };

    const result = await finalizeMeeting(args);

    expect(sidecar.calls).toHaveLength(1);
    expect(result.note.family).toBe('meeting');
    expect(result.note.purpose.length).toBeGreaterThan(0);
    expect(result.note.executive_summary.length).toBeGreaterThan(0);
    expect(result.telemetry.chunkCount).toBe(1);
    expect(result.telemetry.modelId).toBe('llama-3.2-3b-q4-km');
    // No diarization warning on 'ok' status
    expect(result.note.validation_warnings ?? []).not.toContain(SINGLE_SPEAKER_WARNING);
    expect(result.telemetry.validationWarnings).toHaveLength(0);
  });

  it('dedup: 3-chunk transcript with repeated decisions → merged note deduplicates', async () => {
    // Use budget=5 to force one segment per chunk (each segment ~7 tokens)
    const profile = profileWithChunkBudget(5);
    const transcript = makeMultiSpeakerTranscript(); // 3 segments

    // All 3 chunks return the same decision text → dedup should leave one decision
    const responses = [
      makeMeetingNoteJson(0),
      makeMeetingNoteJson(5),
      makeMeetingNoteJson(10),
    ];
    const sidecar = mockSidecar({ responses });

    const result = await finalizeMeeting({
      sessionId: 'test',
      transcript,
      sidecar,
      modelProfile: profile,
      diarizationStatus: 'ok',
    });

    expect(sidecar.calls).toHaveLength(3);
    expect(result.telemetry.chunkCount).toBe(3);
    expect(result.note.family).toBe('meeting');
  });

  it('diarization fallback: status disabled → validation_warnings contains SINGLE_SPEAKER_WARNING', async () => {
    const response = makeMeetingNoteJson(0);
    const sidecar = mockSidecar({ responses: [response] });
    const transcript = makeSingleSpeakerTranscript();

    const result = await finalizeMeeting({
      sessionId: 'test',
      transcript,
      sidecar,
      modelProfile,
      diarizationStatus: 'disabled',
    });

    // Warning must appear in note.validation_warnings AND telemetry
    expect(result.note.validation_warnings).toBeDefined();
    expect(result.note.validation_warnings).toContain(SINGLE_SPEAKER_WARNING);
    expect(result.telemetry.validationWarnings).toContain(SINGLE_SPEAKER_WARNING);

    // The transcript passed to the sidecar must show a single speaker
    expect(sidecar.calls).toHaveLength(1);
    const prompt = sidecar.calls[0]!.prompt;
    // After degradation, the transcript section shows only speaker 0
    expect(prompt).toContain('Speaker map:');
    // The transcript block should show a single collapsed speaker (話者)
    // — find the line after 'Speaker map:' and confirm it only has Speaker 0
    const transcriptSection = prompt.split('Transcript:\n')[1] ?? '';
    expect(transcriptSection).toContain('Speaker 0 = 話者');
    expect(transcriptSection).not.toMatch(/Speaker 1 =/);
  });

  it('diarization disabled → hallucinated speaker refs collapse to 0, participants dropped', async () => {
    // Same class as the interview founder P1 (2026-06-10): with diarization
    // off, the model can still emit arbitrary ints into SpeakerRef slots —
    // grammar (json-number) and Zod (nonnegative) both accept them.
    const raw = JSON.stringify({
      schemaVersion: 1,
      family: 'meeting',
      title: 'テスト会議',
      generatedAt: new Date().toISOString(),
      generatedBy: { model: 'llama-3.2-3b-q4-km', promptVersion: 1 },
      language: 'ja',
      durationSec: 60,
      purpose: 'プロジェクトの進捗確認',
      executive_summary: 'プロジェクトは順調に進んでいます。',
      topic_arc: [{ topic: '進捗', ts: 0, speakers_involved: [1, 2] }],
      discussions: [{ topic: '進捗報告', ts_start: 0, summary: '報告がありました。' }],
      decisions: [{ text: 'リリース日を決定', ts: 0, made_by: 2 }],
      open_questions: [{ text: '予算は確定か', ts: 5, asked_by: 3 }],
      next_steps: [{ text: '資料送付', owner: 4, ts: 5 }],
      participants: [{ speakerRef: 1 }, { speakerRef: 2 }],
    });
    const sidecar = mockSidecar({ responses: [raw] });

    const result = await finalizeMeeting({
      sessionId: 'test',
      transcript: makeSingleSpeakerTranscript(),
      sidecar,
      modelProfile,
      diarizationStatus: 'disabled',
    });

    expect(result.note.topic_arc[0]!.speakers_involved).toEqual([0]);
    expect(result.note.decisions[0]!.made_by).toBe(0);
    expect(result.note.open_questions[0]!.asked_by).toBe(0);
    expect(result.note.next_steps![0]!.owner).toBe(0);
    expect(result.note.participants).toBeUndefined();
  });

  it('diarization fallback: status fallback also triggers single-speaker warning', async () => {
    // 'fallback' and 'disabled' share the same !== 'ok' degrade branch; assert
    // 'fallback' explicitly so a future split of the branch can't silently drop it.
    const sidecar = mockSidecar({ responses: [makeMeetingNoteJson(0)] });
    const result = await finalizeMeeting({
      sessionId: 'test',
      transcript: makeMultiSpeakerTranscript(),
      sidecar,
      modelProfile,
      diarizationStatus: 'fallback',
    });
    expect(result.note.validation_warnings).toContain(SINGLE_SPEAKER_WARNING);
    expect(result.telemetry.validationWarnings).toContain(SINGLE_SPEAKER_WARNING);
  });

  it('speaker-map injection: prompt contains Speaker map: and [Name] prefixes', async () => {
    const response = makeMeetingNoteJson(0);
    const sidecar = mockSidecar({ responses: [response] });
    const transcript = makeMultiSpeakerTranscript();

    await finalizeMeeting({
      sessionId: 'test',
      transcript,
      sidecar,
      modelProfile,
      diarizationStatus: 'ok',
    });

    const prompt = sidecar.calls[0]!.prompt;

    // Isolate the rendered transcript block: the meeting SYSTEM prompt itself
    // contains an example "Speaker 0 = 佐藤, Speaker 1 = 山田", so asserting on the
    // full combined prompt would false-pass even if renderTranscriptWithSpeakers
    // produced an empty map. Split on the chunkUserTemplate's 'Transcript:\n'
    // marker and assert only within the transcript section.
    const transcriptSection = prompt.split('Transcript:\n')[1] ?? '';
    expect(transcriptSection).not.toBe('');

    // Speaker map header rendered by renderTranscriptWithSpeakers
    expect(transcriptSection).toContain('Speaker map:');
    expect(transcriptSection).toContain('Speaker 0 = 佐藤');
    expect(transcriptSection).toContain('Speaker 1 = 山田');

    // Per-line speaker name prefix (renderTranscriptWithSpeakers format)
    expect(transcriptSection).toContain('[佐藤]');
    expect(transcriptSection).toContain('[山田]');
  });

  it('empty transcript → throws EMPTY_TRANSCRIPT', async () => {
    const sidecar = mockSidecar();
    const transcript: SessionTranscript = {
      sessionId: 'empty',
      speakers: [{ id: 0 }],
      transcriptSegments: [],
    };

    await expect(
      finalizeMeeting({
        sessionId: 'empty',
        transcript,
        sidecar,
        modelProfile,
        diarizationStatus: 'ok',
      }),
    ).rejects.toThrow('EMPTY_TRANSCRIPT');
  });

  // ─── P0b: outer retry on post-decode ZodError (parity with lecture) ──────────
  // Same shape as lecture's P0b test — confirms the orchestrator wrap is applied
  // to the meeting callsite too.

  it('retries chunk with fresh seed when runPostDecodePipeline throws ZodError (P0b)', async () => {
    // Well-formed JSON missing required `executive_summary` (and other required
    // meeting fields). JSON.parse + z.unknown() pass; family.schema.parse Stage 4
    // throws ZodError; outer retry must catch + re-call with a fresh seed.
    const invalidJson = JSON.stringify({
      schemaVersion: 1,
      family: 'meeting',
      title: 'タイトル',
      generatedAt: new Date().toISOString(),
      generatedBy: { model: 'llama-3.2-3b-q4-km', promptVersion: 1 },
      language: 'ja',
      durationSec: 60,
      purpose: 'プロジェクトの進捗確認',
      // missing: executive_summary, topic_arc, discussions, decisions, open_questions
    });
    const validJson = makeMeetingNoteJson(0);
    const sidecar = mockSidecar({ responses: [invalidJson, validJson] });

    const result = await finalizeMeeting({
      sessionId: 'p0b-retry-meeting',
      transcript: makeMultiSpeakerTranscript(),
      sidecar,
      modelProfile,
      diarizationStatus: 'ok',
    });

    expect(sidecar.calls).toHaveLength(2);
    expect(sidecar.calls[1]!.seed).toBeGreaterThan(sidecar.calls[0]!.seed + 200);
    expect(result.note.family).toBe('meeting');
  });

  it('throws CHUNK_FAILED:POST_DECODE_ZOD_EXHAUSTED when post-decode fails on both outer attempts', async () => {
    // Parity with the lecture-orchestrator exhaustion test — same code path
    // in the meeting branch of finalizeMeeting. The lecture test already
    // RED-before-GREEN verified the exhaustion path; this case is added for
    // explicit coverage on the meeting wrap (per the round-2 reviewer's
    // non-blocking observation about asymmetric exhaustion coverage).
    const invalidJson = JSON.stringify({
      schemaVersion: 1,
      family: 'meeting',
      title: 'タイトル',
      generatedAt: new Date().toISOString(),
      generatedBy: { model: 'llama-3.2-3b-q4-km', promptVersion: 1 },
      language: 'ja',
      durationSec: 60,
      purpose: 'プロジェクトの進捗確認',
      // missing: executive_summary, topic_arc, discussions, decisions, open_questions
    });
    const sidecar = mockSidecar({ responses: [invalidJson, invalidJson] });

    await expect(
      finalizeMeeting({
        sessionId: 'p0b-exhaust-meeting',
        transcript: makeMultiSpeakerTranscript(),
        sidecar,
        modelProfile,
        diarizationStatus: 'ok',
      }),
    ).rejects.toThrow(/^CHUNK_FAILED:0:POST_DECODE_ZOD_EXHAUSTED/);

    expect(sidecar.calls).toHaveLength(2);
  });
});
