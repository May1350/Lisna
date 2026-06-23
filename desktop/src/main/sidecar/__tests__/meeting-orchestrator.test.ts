/**
 * Tests for finalizeMeeting (Task 6 — extraction-driven rewire, 2026-06-21).
 *
 * finalizeMeeting now runs ONE grammar-constrained EXTRACTION per chunk
 * (extractMeetingAtoms → flat MeetingExtractSchema atoms), then assembles the
 * note DETERMINISTICALLY (assembleMeetingNote). There is no 2-pass ladder and
 * no LLM merge — so the mock sidecar serves FLAT-ATOM JSON, not full
 * MeetingNote JSON, and every grammar call is a single extraction.
 *
 * Test intents (retargeted from the old 2-pass flow):
 *   1. happy path: single chunk → one extract call, valid MeetingNote.
 *   2. dedup: two chunks emit the SAME decision atom → assembled note.decisions
 *      collapses to 1 entry.
 *   3. diarization fallback (status 'disabled') → validation_warnings contains
 *      SINGLE_SPEAKER_WARNING AND every speaker ref collapses to 0.
 *   4. 'fallback' status also triggers the single-speaker warning.
 *   5. unparseable extract output → finalize STILL returns a valid note (no
 *      throw) with an `extract: chunk N failed` warning.
 *   6. empty transcript → throws EMPTY_TRANSCRIPT.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { finalizeMeeting, type FinalizeMeetingArgs } from '../orchestrator';
import type { GrammarCapableSidecar } from '../grammar-call';
import type { SessionTranscript } from '@shared/note-schema/transcript';
import { MeetingNoteSchema, type MeetingNote } from '@shared/families/meeting/schema';
import { modelProfiles } from '@shared/models/profiles';
import type { ModelProfile } from '@shared/models/profiles';
import { SINGLE_SPEAKER_WARNING } from '@shared/families/meeting/degrade-to-single-speaker';

// ─── inline mock sidecar ────────────────────────────────────────────────────

type MockOpts = {
  /**
   * Canned JSON keyed by CHUNK index, not call index. extractMeetingAtoms calls
   * the generator up to 3 times per chunk (callWithGrammar maxAttempts:3) with
   * seeds `6000 + chunkIndex + (attempt-1)*100`, so a positional `responses[i]`
   * would shift across retries. Keying by chunk makes a chunk's response stable
   * across its own retries — exactly what a "this chunk always fails" test needs.
   * `responses[chunkIndex]` absent → an empty-atoms object (chunk extracts nothing).
   */
  responses?: string[];
};

/** Derive the chunk index from the per-attempt seed (see extractMeetingAtoms:
 *  baseSeed = 6000 + chunkIndex; attempt seed = baseSeed + (attempt-1)*100). */
function chunkIndexFromSeed(seed: number): number {
  return (seed - 6000) % 100;
}

/**
 * Extraction-aware mock. finalizeMeeting only ever issues grammar-constrained
 * extraction calls (grammar !== ''), up to 3 per chunk. A given chunk's response
 * is fixed regardless of retry count.
 */
function mockSidecar(
  opts: MockOpts = {},
): GrammarCapableSidecar & {
  calls: Array<{ prompt: string; system?: string; grammar: string; seed: number }>;
} {
  const responses = opts.responses;
  const calls: Array<{ prompt: string; system?: string; grammar: string; seed: number }> = [];
  const emptyAtoms = JSON.stringify({
    decisions: [],
    action_items: [],
    key_figures: [],
    open_questions: [],
    risks: [],
  });
  return {
    calls,
    async generateWithGrammar(req) {
      calls.push({ prompt: req.prompt, system: req.system, grammar: req.grammar, seed: req.seed });
      const ci = chunkIndexFromSeed(req.seed);
      const text = responses ? (responses[ci] ?? emptyAtoms) : makeAtomsJson();
      return { text, seed: req.seed };
    },
  };
}

// ─── fixtures ────────────────────────────────────────────────────────────────

/**
 * Build a flat MeetingExtractSchema JSON string (the per-chunk extraction
 * shape). All fields are arrays of atoms; the assembler synthesizes the note
 * structure (topic_arc, discussions, summary) deterministically from these.
 *
 * Defaults emit one decision + one action item with JA text so the assembled
 * note is non-trivial. `decisionText` lets tests force a shared decision across
 * chunks (dedup). `madeBy`/`owner` let the diarization tests plant non-zero
 * speaker refs that must collapse to 0.
 */
function makeAtomsJson(opts?: {
  decisionText?: string;
  madeBy?: number;
  owner?: number;
  askedBy?: number;
  raisedBy?: number;
}): string {
  const o = opts ?? {};
  return JSON.stringify({
    title: 'プロジェクト定例会議',
    purpose: 'プロジェクトの進捗確認',
    decisions: [
      {
        text: o.decisionText ?? 'リリース日を六月末に決定する',
        ts: 0,
        ...(o.madeBy !== undefined ? { made_by: o.madeBy } : {}),
      },
    ],
    action_items: [
      {
        task: '設計資料を作成して共有する',
        ts: 5,
        ...(o.owner !== undefined ? { owner: o.owner } : {}),
      },
    ],
    key_figures: [{ label: '予算', value: '一千万円', ts: 5 }],
    open_questions: [
      {
        text: '予算は確定しているか',
        ts: 10,
        ...(o.askedBy !== undefined ? { asked_by: o.askedBy } : {}),
      },
    ],
    risks: [
      {
        text: '人員が不足するリスクがある',
        ts: 10,
        ...(o.raisedBy !== undefined ? { raised_by: o.raisedBy } : {}),
      },
    ],
  });
}

/** Build a SessionTranscript with named speakers and multi-speaker segments. */
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

/** Single-speaker transcript (alpha path where all speakerId=0). */
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

/** Override recommendedChunkTokens on the meeting profile to force chunking. */
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

/** Assert the produced object is a real MeetingNote with a synthesized arc. */
function expectValidMeetingNote(note: MeetingNote): void {
  expect(() => MeetingNoteSchema.parse(note)).not.toThrow();
  expect(note.family).toBe('meeting');
  expect(note.topic_arc.length).toBeGreaterThanOrEqual(1);
}

// Register meeting family once before all tests
beforeAll(async () => {
  await import('@shared/families/meeting/core');
});

const modelProfile = modelProfiles['llama-3.2-3b-q4-km']!;

// ─── tests ───────────────────────────────────────────────────────────────────

describe('finalizeMeeting', () => {
  it('happy path: single chunk → one extract call, valid MeetingNote', async () => {
    const sidecar = mockSidecar({ responses: [makeAtomsJson()] });
    const args: FinalizeMeetingArgs = {
      sessionId: 'test',
      transcript: makeMultiSpeakerTranscript(),
      sidecar,
      modelProfile,
      diarizationStatus: 'ok',
    };

    const result = await finalizeMeeting(args);

    expect(sidecar.calls).toHaveLength(1); // one extraction call
    expectValidMeetingNote(result.note);
    expect(result.note.purpose.length).toBeGreaterThan(0);
    expect(result.note.executive_summary.length).toBeGreaterThan(0);
    expect(result.telemetry.chunkCount).toBe(1);
    expect(result.telemetry.modelId).toBe('llama-3.2-3b-q4-km');
    // No diarization warning on 'ok'.
    expect(result.note.validation_warnings ?? []).not.toContain(SINGLE_SPEAKER_WARNING);
    expect(result.telemetry.validationWarnings).toHaveLength(0);
  });

  it('dedup: two chunks emit the same decision atom → note.decisions has 1 entry', async () => {
    // budget=5 forces one segment per chunk (≈7 tokens each) → 3 chunks.
    const profile = profileWithChunkBudget(5);
    // Identical text → trigram jaccard 1.0; the embedded number "30" gives the
    // shared anchor unionContentAtoms requires (anchor AND jaccard>=0.7 to dedup).
    const sharedDecision = '予算を30万円増額することを決定する';
    // Chunks 0 and 1 emit the SAME decision text (keyed by chunk index); chunk
    // 2 (absent from responses) extracts empty atoms.
    const responses = [
      makeAtomsJson({ decisionText: sharedDecision }),
      makeAtomsJson({ decisionText: sharedDecision }),
    ];
    const sidecar = mockSidecar({ responses });

    const result = await finalizeMeeting({
      sessionId: 'test',
      transcript: makeMultiSpeakerTranscript(), // 3 segments → 3 chunks
      sidecar,
      modelProfile: profile,
      diarizationStatus: 'ok',
    });

    // 3 chunks, each succeeds on the first extraction attempt → 3 calls.
    expect(sidecar.calls).toHaveLength(3);
    expect(result.telemetry.chunkCount).toBe(3);
    expectValidMeetingNote(result.note);
    // The repeated decision is deduped by the assembler to a single entry.
    const matches = result.note.decisions.filter((d) => d.text === sharedDecision);
    expect(matches).toHaveLength(1);
  });

  it('diarization fallback (disabled): single-speaker warning + every speaker ref collapses to 0', async () => {
    // Plant non-zero speaker refs in the extracted atoms; with diarization off
    // they must all normalize to 0 (founder P1, 2026-06-10).
    const sidecar = mockSidecar({
      responses: [makeAtomsJson({ madeBy: 2, owner: 4, askedBy: 3, raisedBy: 5 })],
    });

    const result = await finalizeMeeting({
      sessionId: 'test',
      transcript: makeSingleSpeakerTranscript(),
      sidecar,
      modelProfile,
      diarizationStatus: 'disabled',
    });

    expectValidMeetingNote(result.note);
    expect(result.note.validation_warnings).toContain(SINGLE_SPEAKER_WARNING);
    expect(result.telemetry.validationWarnings).toContain(SINGLE_SPEAKER_WARNING);

    // Every SpeakerRef slot reachable from the assembled note is 0.
    for (const t of result.note.topic_arc) {
      for (const s of t.speakers_involved) expect(s).toBe(0);
    }
    for (const d of result.note.decisions) {
      if (d.made_by !== undefined) expect(d.made_by).toBe(0);
    }
    for (const q of result.note.open_questions) {
      if (q.asked_by !== undefined) expect(q.asked_by).toBe(0);
    }
    for (const a of result.note.next_steps ?? []) {
      if (a.owner !== undefined) expect(a.owner).toBe(0);
    }
    for (const r of result.note.risks_or_concerns ?? []) {
      if (r.raised_by !== undefined) expect(r.raised_by).toBe(0);
    }
    expect(result.note.participants).toBeUndefined();
  });

  it('diarization fallback: status fallback also triggers single-speaker warning', async () => {
    // 'fallback' and 'disabled' share the same !== 'ok' degrade branch; assert
    // 'fallback' explicitly so a future split can't silently drop it.
    const sidecar = mockSidecar({ responses: [makeAtomsJson()] });
    const result = await finalizeMeeting({
      sessionId: 'test',
      transcript: makeMultiSpeakerTranscript(),
      sidecar,
      modelProfile,
      diarizationStatus: 'fallback',
    });
    expectValidMeetingNote(result.note);
    expect(result.note.validation_warnings).toContain(SINGLE_SPEAKER_WARNING);
    expect(result.telemetry.validationWarnings).toContain(SINGLE_SPEAKER_WARNING);
  });

  it('unparseable extract output → finalize still returns a valid note with an extract-failed warning', async () => {
    // A chunk whose extraction emits non-JSON. extractMeetingAtoms returns
    // ok:false with empty atoms so the assembler continues with the other
    // chunks; the orchestrator surfaces an `extract: chunk N failed` warning.
    const profile = profileWithChunkBudget(5); // 3 chunks
    // Chunk 1's response is non-JSON for ALL its retries (mock keys by chunk).
    const responses = [
      makeAtomsJson(),
      'this is not valid json at all {{{',
      makeAtomsJson(),
    ];
    const sidecar = mockSidecar({ responses });

    const result = await finalizeMeeting({
      sessionId: 'test',
      transcript: makeMultiSpeakerTranscript(),
      sidecar,
      modelProfile: profile,
      diarizationStatus: 'ok',
    });

    expectValidMeetingNote(result.note);
    // Chunk 1 (0-based) fails all 3 attempts → ok:false; chunks 0 and 2 succeed
    // on attempt 1. So 1 + 3 + 1 = 5 generator calls total.
    expect(sidecar.calls).toHaveLength(5);
    const warnings = result.note.validation_warnings ?? [];
    expect(warnings.some((w) => /^extract: chunk 1 failed/.test(w))).toBe(true);
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
});
