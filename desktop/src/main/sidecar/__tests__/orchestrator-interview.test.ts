/**
 * Tests for finalizeInterview (Plan 6 Task 13).
 * Mirrors meeting-orchestrator.test.ts; adds the merge-LLM branch (Task 7).
 *
 * Interview requiresDiarization=true → it mirrors finalizeMeeting's diarization
 * fallback (degradeToSingleSpeaker + SINGLE_SPEAKER_WARNING). The cross-chunk
 * merge is the HYBRID runMergeLLMCall: qa_pairs are unioned deterministically
 * (never dropped by the LLM), only themes/key_takeaways/subject_summary come
 * from the merge LLM.
 *
 * Cases:
 *   1. single-chunk happy path → InterviewNote, qa_pairs[].from filled (F2)
 *   2. multi-chunk → unions ALL qa_pairs even when the merge LLM drops some
 *   3. merge LLM exhausts retries → deterministic fallback keeps every qa_pair + warns
 *   4. diarization disabled → SINGLE_SPEAKER_WARNING in note + telemetry
 *   5. empty transcript → throws EMPTY_TRANSCRIPT
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { finalizeInterview, type FinalizeInterviewArgs } from '../orchestrator';
import type { GrammarCapableSidecar } from '../grammar-call';
import type { SessionTranscript } from '@shared/note-schema/transcript';
import { modelProfiles } from '@shared/models/profiles';
import type { ModelProfile } from '@shared/models/profiles';
import { SINGLE_SPEAKER_WARNING } from '@shared/families/meeting/degrade-to-single-speaker';
import type { InterviewNote } from '@shared/families/interview/schema';

// ─── inline mock sidecar (mirrors meeting-orchestrator.test.ts) ──────────────

type MockOpts = { responses?: string[] };

function mockSidecar(
  opts: MockOpts = {},
): GrammarCapableSidecar & { calls: Array<{ prompt: string; grammar: string; seed: number }> } {
  const responses = opts.responses;
  const calls: Array<{ prompt: string; grammar: string; seed: number }> = [];
  let idx = 0;
  return {
    calls,
    async generateWithGrammar(req) {
      calls.push({ prompt: req.prompt, grammar: req.grammar, seed: req.seed });
      const text = responses ? (responses[idx] ?? '{}') : makeInterviewNoteJson();
      idx++;
      return { text, seed: req.seed };
    },
  };
}

// ─── fixtures ─────────────────────────────────────────────────────────────────

function qaRaw(question: string, answer: string, ts: number): Record<string, unknown> {
  // No `from` — the per-chunk pipeline fills it (F2).
  return { question, answer, ts, asked_by: 0, answered_by: 1 };
}

/** Minimal valid per-chunk InterviewNote JSON (qa_pairs carry NO `from`). */
function makeInterviewNoteJson(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: 1,
    family: 'interview',
    title: 'インタビュー',
    generatedAt: '2026-05-29T00:00:00.000Z',
    generatedBy: { model: 'llama-3.2-3b-q4-km', promptVersion: 1 },
    language: 'ja',
    durationSec: 1800,
    purpose: 'テスト目的',
    subject_summary: 'チャンク単位のサマリー',
    qa_pairs: [qaRaw('Q', 'A', 0)],
    themes: [],
    quotable_lines: [],
    key_takeaways: [],
    ...over,
  });
}

/** A merge-LLM response carrying only the derived (merge-llm) fields. */
function makeMergeResponse(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    themes: [{ name: '意思決定', appears_at_ts: [0, 5] }],
    key_takeaways: [{ text: '統合された洞察' }],
    subject_summary: '統合された被取材者サマリー',
    ...over,
  });
}

function makeMultiSpeakerTranscript(): SessionTranscript {
  return {
    sessionId: 'test-interview',
    speakers: [
      { id: 0, name: '記者' },
      { id: 1, name: '回答者' },
    ],
    transcriptSegments: [
      { ts: 0, endTs: 4, text: '質問です。', speakerId: 0 },
      { ts: 5, endTs: 9, text: '回答です。', speakerId: 1 },
    ],
  };
}

/** Override interview's recommendedChunkTokens to force one segment per chunk. */
function profileWithInterviewChunkBudget(budget: number): ModelProfile {
  const base = modelProfiles['llama-3.2-3b-q4-km']!;
  return {
    ...base,
    perFamily: {
      ...base.perFamily,
      interview: { ...base.perFamily['interview']!, recommendedChunkTokens: budget },
    },
  };
}

beforeAll(async () => {
  await import('@shared/families/interview/core');
});

const modelProfile = modelProfiles['llama-3.2-3b-q4-km']!;

// ─── tests ─────────────────────────────────────────────────────────────────────

describe('finalizeInterview', () => {
  it('single-chunk happy path → InterviewNote with qa_pairs[].from filled (F2)', async () => {
    const sidecar = mockSidecar({ responses: [makeInterviewNoteJson({ qa_pairs: [qaRaw('Q0', 'A0', 0)] })] });
    const args: FinalizeInterviewArgs = {
      sessionId: 'test',
      transcript: makeMultiSpeakerTranscript(),
      sidecar,
      modelProfile,
      diarizationStatus: 'ok',
    };
    const result = await finalizeInterview(args);

    expect(sidecar.calls).toHaveLength(1);
    expect(result.note.family).toBe('interview');
    expect(result.telemetry.chunkCount).toBe(1);
    expect(result.note.qa_pairs).toHaveLength(1);
    // F2: per-chunk pipeline filled `from`. ts=0 matches the segment at ts=0.
    expect(result.note.qa_pairs[0]!.from).toBe('transcript');
    expect(result.note.validation_warnings ?? []).not.toContain(SINGLE_SPEAKER_WARNING);
  });

  it('multi-chunk: unions ALL qa_pairs even when the merge LLM drops some', async () => {
    const profile = profileWithInterviewChunkBudget(5); // 1 segment per chunk → 2 chunks
    const sidecar = mockSidecar({
      responses: [
        makeInterviewNoteJson({ qa_pairs: [qaRaw('Q0', 'A0', 0)] }),
        makeInterviewNoteJson({ qa_pairs: [qaRaw('Q1', 'A1', 5)] }),
        // merge LLM drops qa_pairs entirely — deterministic union must ignore that.
        makeMergeResponse(),
      ],
    });

    const result = await finalizeInterview({
      sessionId: 'test',
      transcript: makeMultiSpeakerTranscript(),
      sidecar,
      modelProfile: profile,
      diarizationStatus: 'ok',
    });

    expect(sidecar.calls).toHaveLength(3); // 2 chunks + 1 merge
    expect(result.telemetry.chunkCount).toBe(2);
    const note = result.note as InterviewNote;
    expect(note.qa_pairs.map((q) => q.question)).toEqual(['Q0', 'Q1']);
    expect(note.qa_pairs.map((q) => q.ts)).toEqual([0, 5]);
    // derived prose taken from the merge LLM
    expect(note.subject_summary).toBe('統合された被取材者サマリー');
    expect(note.validation_warnings ?? []).toEqual([]);
  });

  it('merge LLM exhausts retries → deterministic fallback keeps every qa_pair + warns', async () => {
    const profile = profileWithInterviewChunkBudget(5);
    const sidecar = mockSidecar({
      responses: [
        makeInterviewNoteJson({ qa_pairs: [qaRaw('Q0', 'A0', 0)] }),
        makeInterviewNoteJson({ qa_pairs: [qaRaw('Q1', 'A1', 5)] }),
        // merge call + its 2 retries all return unparseable JSON → ok:false
        'not json {',
        'not json {',
        'not json {',
      ],
    });

    const result = await finalizeInterview({
      sessionId: 'test',
      transcript: makeMultiSpeakerTranscript(),
      sidecar,
      modelProfile: profile,
      diarizationStatus: 'ok',
    });

    const note = result.note as InterviewNote;
    // qa_pairs (deterministic union) preserved despite the merge LLM failing
    expect(note.qa_pairs.map((q) => q.question)).toEqual(['Q0', 'Q1']);
    // a warning records the degraded merge
    expect((note.validation_warnings ?? []).join(' ')).toMatch(/merge/i);
    expect(result.telemetry.validationWarnings.join(' ')).toMatch(/merge/i);
  });

  it('diarization disabled → SINGLE_SPEAKER_WARNING in note + telemetry', async () => {
    const sidecar = mockSidecar({ responses: [makeInterviewNoteJson()] });
    const result = await finalizeInterview({
      sessionId: 'test',
      transcript: makeMultiSpeakerTranscript(),
      sidecar,
      modelProfile,
      diarizationStatus: 'disabled',
    });

    expect(result.note.validation_warnings).toContain(SINGLE_SPEAKER_WARNING);
    expect(result.telemetry.validationWarnings).toContain(SINGLE_SPEAKER_WARNING);
    // degraded transcript shows a single collapsed speaker
    const transcriptSection = sidecar.calls[0]!.prompt.split('Transcript:\n')[1] ?? '';
    expect(transcriptSection).toContain('Speaker 0 = 話者');
    expect(transcriptSection).not.toMatch(/Speaker 1 =/);
  });

  it('empty transcript → throws EMPTY_TRANSCRIPT', async () => {
    const sidecar = mockSidecar();
    await expect(
      finalizeInterview({
        sessionId: 'empty',
        transcript: { sessionId: 'empty', speakers: [{ id: 0 }], transcriptSegments: [] },
        sidecar,
        modelProfile,
        diarizationStatus: 'ok',
      }),
    ).rejects.toThrow('EMPTY_TRANSCRIPT');
  });
});
