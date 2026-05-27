/**
 * Tests for finalizeLecture (Task 9).
 * Uses an inline mockSidecar — no shared test-helpers module needed.
 *
 * Four test cases per plan §1212-1257:
 *   1. 1-chunk transcript → 1 grammar call
 *   2. 3-chunk transcript → 3 grammar calls, ZERO merge-LLM calls (deterministic)
 *   3. retry budget: chunk-0 fails once, total grammar calls = chunkCount + 1
 *   4. validation_warnings stays empty (Lecture has no SpeakerRef)
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { finalizeLecture, type FinalizeLectureArgs } from '../orchestrator';
import type { GrammarCapableSidecar } from '../grammar-call';
import type { SessionTranscript } from '@shared/note-schema/transcript';
import { modelProfiles } from '@shared/models/profiles';
import type { ModelProfile } from '@shared/models/profiles';

// ─── inline mock sidecar ────────────────────────────────────────────────────

type MockOpts = {
  /** Canned JSON strings, one per successful call. Defaults to valid LectureNote JSON. */
  responses?: string[];
  /** call-index → number of failures before that call succeeds */
  failuresPerCall?: Record<number, number>;
};

function mockSidecar(
  opts: MockOpts = {},
): GrammarCapableSidecar & { calls: Array<{ prompt: string; grammar: string; seed: number }> } {
  const responses = opts.responses;
  const failures = opts.failuresPerCall ?? {};
  const calls: Array<{ prompt: string; grammar: string; seed: number }> = [];
  let successCallIdx = 0;
  let totalCallIdx = 0;
  return {
    calls,
    async generateWithGrammar(req) {
      calls.push({ prompt: req.prompt, grammar: req.grammar, seed: req.seed });
      if (failures[successCallIdx] && failures[successCallIdx]! > 0) {
        failures[successCallIdx]!--;
        totalCallIdx++;
        throw new Error('mock-fail');
      }
      const text = responses ? (responses[successCallIdx] ?? '{}') : makeLectureNoteJson('セクション', 0);
      successCallIdx++;
      totalCallIdx++;
      return { text, seed: req.seed };
    },
  };
}

// ─── fixtures ────────────────────────────────────────────────────────────────

/**
 * Build a minimal valid LectureNote JSON string that passes LectureNoteSchema.parse()
 * after the post-decode pipeline.
 *
 * Pipeline Stage 3 fills `from` provenance on items with ts + (text|term|expression),
 * so we must NOT include `from` in the raw JSON — the pipeline inserts it post-hoc.
 */
function makeLectureNoteJson(sectionHeading: string, ts: number): string {
  return JSON.stringify({
    schemaVersion: 1,
    family: 'lecture',
    title: 'テスト講義',
    generatedAt: new Date().toISOString(),
    generatedBy: { model: 'llama-3.2-3b-q4-km', promptVersion: 1 },
    language: 'ja',
    durationSec: 60,
    sections: [
      {
        heading: sectionHeading,
        ts,
        summary: 'テストの要約です。',
        key_terms: [{ term: '概念', definition: '定義', ts }],
        examples: [],
        points: [{ text: '重要な点', ts, important: true }],
      },
    ],
  });
}

/**
 * A tiny SessionTranscript with `segmentCount` segments at ts=0,5,10,...
 * Segment text is short ASCII so token estimates are low (~5 tokens each).
 */
function makeTranscript(segmentCount: number): SessionTranscript {
  return {
    sessionId: 'test',
    speakers: [{ id: 0 }],
    transcriptSegments: Array.from({ length: segmentCount }, (_, i) => ({
      ts: i * 5,
      endTs: i * 5 + 4,
      text: `Segment ${i + 1} text content here.`,  // ASCII ~27 chars → ~7 tokens
      speakerId: 0,
    })),
  };
}

/**
 * Build a model profile with an overridden recommendedChunkTokens for
 * multi-chunk tests. ASCII segments ≈7 tokens each.
 * Budget=15 → ~2 segs/chunk. Budget=10 → ~1-2 segs/chunk.
 */
function profileWithChunkBudget(budget: number): ModelProfile {
  const base = modelProfiles['llama-3.2-3b-q4-km']!;
  return {
    ...base,
    perFamily: {
      ...base.perFamily,
      lecture: { ...base.perFamily.lecture, recommendedChunkTokens: budget },
    },
  };
}

// Register lecture family once before all tests
beforeAll(async () => {
  await import('@shared/families/lecture/core');
});

// Real model profile for single-chunk tests — per task spec ("don't stub it")
const modelProfile = modelProfiles['llama-3.2-3b-q4-km']!;

// ─── tests ───────────────────────────────────────────────────────────────────

describe('finalizeLecture', () => {
  it('1-chunk transcript → exactly 1 grammar call, note has family=lecture', async () => {
    const response = makeLectureNoteJson('導入', 0);
    const sidecar = mockSidecar({ responses: [response] });
    // 3 short segments at default budget (8000 tokens) = trivially 1 chunk
    const transcript = makeTranscript(3);

    const args: FinalizeLectureArgs = {
      sessionId: 'test',
      transcript,
      sidecar,
      modelProfile,
    };

    const result = await finalizeLecture(args);

    expect(sidecar.calls).toHaveLength(1);
    expect(result.note.family).toBe('lecture');
    expect(result.note.sections.length).toBeGreaterThan(0);
    expect(result.telemetry.chunkCount).toBe(1);
    expect(result.telemetry.modelId).toBe('llama-3.2-3b-q4-km');
  });

  it('3-chunk transcript → exactly 3 grammar calls, ZERO merge-LLM calls', async () => {
    // Use budget=20 tokens and 9 segments of ~7 tokens each.
    // 20 tokens budget: 2 segments fit per chunk (2×7=14 ≤ 20, 3×7=21 > 20)
    // → ceil(9 / 2) ≈ 5 chunks with silence-snap variants, or 9/3 = 3 exact if snap hits.
    // To guarantee exactly 3 chunks: use budget=50 with 9 ASCII segments.
    // 50 tokens: 7 segs fit (7×7=49 ≤ 50); 8 would exceed. So 9 segs → 2 chunks (7+2).
    // Better: use 3 segments with budget=5 so each segment (≈7 tokens) overflows by itself.
    // Actually with budget=5: segment 0 (7 tok) > 5 → goes into first chunk alone.
    // Let's use 3 segments with the default budget — that forces 1 chunk.
    // For exactly 3 chunks, use budget=5 with 3 segments:
    //   - seg 0: 7 tokens → exceeds 5, but we're AT cursorIdx=0, so it always appends
    //             (the overflow guard is `if tokens + segTokens > maxTokens AND i > cursorIdx`)
    //   - seg 0 sits alone (tokens=7, softEndIdx=0), next iter cursor=1
    //   - seg 1: 7 tokens (same), chunk=[seg1], cursor=2
    //   - seg 2: last, chunk=[seg2]
    //   → 3 chunks of 1 segment each ✓
    const budget = 5; // forces 1 segment per chunk given ~7-token segments
    const profile = profileWithChunkBudget(budget);
    const transcript = makeTranscript(3);

    // Provide exactly 3 responses — one per chunk
    const responses = [
      makeLectureNoteJson('章 1', 0),
      makeLectureNoteJson('章 2', 5),
      makeLectureNoteJson('章 3', 10),
    ];
    const sidecar = mockSidecar({ responses });

    const args: FinalizeLectureArgs = {
      sessionId: 'test',
      transcript,
      sidecar,
      modelProfile: profile,
    };

    const result = await finalizeLecture(args);

    // Exactly 3 grammar calls (Lecture = no merge-LLM call)
    expect(sidecar.calls).toHaveLength(3);
    expect(result.telemetry.chunkCount).toBe(3);
    expect(result.note.family).toBe('lecture');
    // All 3 sections should be in the merged note (concat-only + sortByTs)
    expect(result.note.sections.length).toBe(3);
  });

  it('retry budget: chunk-0 fails once → total calls = 4', async () => {
    // Same 3-chunk setup as above
    const budget = 5;
    const profile = profileWithChunkBudget(budget);
    const transcript = makeTranscript(3);
    const responses = [
      makeLectureNoteJson('章 1', 0),
      makeLectureNoteJson('章 2', 5),
      makeLectureNoteJson('章 3', 10),
    ];
    // successCallIdx 0 fails once before succeeding
    const sidecar = mockSidecar({ responses, failuresPerCall: { 0: 1 } });

    const args: FinalizeLectureArgs = {
      sessionId: 'test',
      transcript,
      sidecar,
      modelProfile: profile,
    };

    const result = await finalizeLecture(args);

    // 1 failure (chunk-0 attempt 1) + 1 success (chunk-0 attempt 2) +
    // 1 success (chunk-1) + 1 success (chunk-2) = 4 total calls
    expect(sidecar.calls).toHaveLength(4);
    expect(result.note.family).toBe('lecture');
    expect(result.note.sections.length).toBe(3);
  });

  it('throws CHUNK_FAILED when a chunk exhausts all 3 retry attempts', async () => {
    const sidecar = mockSidecar({
      responses: [],                       // never consulted — every attempt fails
      failuresPerCall: { 0: 5 },           // chunk 0 fails > maxAttempts(3)
    });
    await expect(
      finalizeLecture({
        sessionId: 'exhaust-test',
        transcript: makeTranscript(1),     // single-segment → single-chunk
        sidecar,
        modelProfile: modelProfiles['llama-3.2-3b-q4-km']!,
      }),
    ).rejects.toThrow(/^CHUNK_FAILED:0:/);
  });

  it('telemetry shape ships empty arrays for warnings/dedup/mutations (placeholder until pipeline plumbs them — Plan 7)', async () => {
    const response = makeLectureNoteJson('単一セクション', 0);
    const sidecar = mockSidecar({ responses: [response] });
    const transcript = makeTranscript(3);

    const args: FinalizeLectureArgs = {
      sessionId: 'test',
      transcript,
      sidecar,
      modelProfile,
    };

    const result = await finalizeLecture(args);

    // TODO(plan-7): when pipeline returns side-channel telemetry, replace these constant assertions with real-value checks.
    // Lecture schema has no SpeakerRef → pipeline produces no warnings
    expect(result.telemetry.validationWarnings).toEqual([]);
    expect(result.telemetry.dedupHits).toEqual([]);
    expect(result.telemetry.postDecodeMutations).toEqual([]);
  });
});
