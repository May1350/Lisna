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
import { describe, it, expect, beforeAll, vi } from 'vitest';
import {
  finalizeLecture,
  type FinalizeLectureArgs,
  type FinalizeTelemetryEvent,
} from '../orchestrator';
import type { GrammarCapableSidecar } from '../grammar-call';
import type { SessionTranscript } from '@shared/note-schema/transcript';
import { modelProfiles } from '@shared/models/profiles';
import type { ModelProfile } from '@shared/models/profiles';

// ─── inline mock sidecar ────────────────────────────────────────────────────

type MockOpts = {
  /** Canned JSON strings, one per successful PASS-2 (grammar) call. Defaults to valid LectureNote JSON. */
  responses?: string[];
  /** PASS-2 call-index → number of failures before that call succeeds */
  failuresPerCall?: Record<number, number>;
};

/** Canned PASS-1 free-prose blob: grounded JA, well over the 100-char
 *  language-guard floor so pass-1 always advances to pass-2. */
const PASS1_PROSE = 'この講義の要約です。重要な概念と具体例を順に説明しています。' + 'あ'.repeat(120);

/**
 * 2-pass aware mock (per-chunk fabrication fix, 2026-06-14). PASS-1 calls
 * (empty grammar) are served a canned JA prose and recorded in `pass1Calls`
 * but do NOT consume `responses[]` / `failuresPerCall`. PASS-2 calls (the
 * grammar-constrained structuring step) drive `calls` + `responses[]` +
 * `failuresPerCall` exactly as the single-pass mock did — so `calls.length`
 * still equals the number of structuring calls (≈ chunk count + retries) and
 * the seed/JSON assertions read the pass-2 stream.
 */
function mockSidecar(
  opts: MockOpts = {},
): GrammarCapableSidecar & {
  calls: Array<{ prompt: string; system?: string; grammar: string; seed: number }>;
  pass1Calls: Array<{ prompt: string; system?: string; seed: number }>;
} {
  const responses = opts.responses;
  const failures = opts.failuresPerCall ?? {};
  const calls: Array<{ prompt: string; system?: string; grammar: string; seed: number }> = [];
  const pass1Calls: Array<{ prompt: string; system?: string; seed: number }> = [];
  let successCallIdx = 0;
  return {
    calls,
    pass1Calls,
    async generateWithGrammar(req) {
      if (req.grammar === '') {
        // PASS 1 — free-prose grounding step.
        pass1Calls.push({ prompt: req.prompt, system: req.system, seed: req.seed });
        return { text: PASS1_PROSE, seed: req.seed };
      }
      // PASS 2 — grammar-constrained structuring step.
      calls.push({ prompt: req.prompt, system: req.system, grammar: req.grammar, seed: req.seed });
      if (failures[successCallIdx] && failures[successCallIdx]! > 0) {
        failures[successCallIdx]!--;
        throw new Error('mock-fail');
      }
      const text = responses ? (responses[successCallIdx] ?? '{}') : makeLectureNoteJson('セクション', 0);
      successCallIdx++;
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
    // 3 short segments at default budget (3000 tokens) = trivially 1 chunk
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

  // ─── P0b: outer retry on post-decode ZodError ────────────────────────────────
  // callWithGrammar receives `schema: z.unknown()` (pass-through), so its
  // per-attempt retry-on-Zod contract no-ops for the real family shape. The
  // family.schema.parse() runs inside runPostDecodePipeline (Stage 4) AFTER
  // callWithGrammar returns ok=true. Without an outer retry, a single bad
  // emission burns the whole chunk and propagates ZodError out of
  // finalizeLecture with no recovery. P0b wraps the per-chunk pair in a small
  // outer retry loop with a disjoint seed-block per attempt.

  it('retries chunk with fresh seed when runPostDecodePipeline throws ZodError (P0b)', async () => {
    // Well-formed JSON missing the required `sections` field — JSON.parse
    // succeeds (callWithGrammar's z.unknown() passes through), but
    // family.schema.parse() inside runPostDecodePipeline Stage 4 throws
    // ZodError. The orchestrator's outer retry must catch this and re-call
    // callWithGrammar with a fresh seed block.
    const invalidJson = JSON.stringify({
      schemaVersion: 1,
      family: 'lecture',
      title: 'タイトル',
      generatedAt: new Date().toISOString(),
      generatedBy: { model: 'llama-3.2-3b-q4-km', promptVersion: 1 },
      language: 'ja',
      durationSec: 60,
      // missing: sections (required) — Stage 4 will throw ZodError
    });
    const validJson = makeLectureNoteJson('セクション', 0);
    const sidecar = mockSidecar({ responses: [invalidJson, validJson] });

    const result = await finalizeLecture({
      sessionId: 'p0b-retry',
      transcript: makeTranscript(3),  // 3 segs at default budget → 1 chunk
      sidecar,
      modelProfile,
    });

    // Two sidecar calls: outer attempt 0 produced invalid JSON, outer attempt 1 valid.
    expect(sidecar.calls).toHaveLength(2);
    // The outer retry advances baseSeed by a block strictly larger than
    // callWithGrammar's inner stride (+0/+100/+200), so the second outer
    // attempt's first inner seed cannot collide with the first attempt's
    // inner retries. >200 is the load-bearing guarantee.
    expect(sidecar.calls[1]!.seed).toBeGreaterThan(sidecar.calls[0]!.seed + 200);
    expect(result.note.family).toBe('lecture');
    expect(result.note.sections.length).toBe(1);
  });

  it('throws CHUNK_FAILED:POST_DECODE_ZOD when pass-2 post-decode fails on every reseed', async () => {
    // Every pass-2 structuring attempt emits JSON missing `sections` → Stage 4
    // ZodError → reseed pass-2, then fresh pass-1, until MAX_GEN_PER_CHUNK. The
    // mock falls back to '{}' after the two scripted responses, so all 6 pass-2
    // attempts (2 pass-1 × 3 pass-2) fail with POST_DECODE_ZOD.
    const invalidJson = JSON.stringify({
      schemaVersion: 1,
      family: 'lecture',
      title: 'タイトル',
      generatedAt: new Date().toISOString(),
      generatedBy: { model: 'llama-3.2-3b-q4-km', promptVersion: 1 },
      language: 'ja',
      durationSec: 60,
      // missing: sections
    });
    const sidecar = mockSidecar({ responses: [invalidJson, invalidJson] });

    await expect(
      finalizeLecture({
        sessionId: 'p0b-exhaust',
        transcript: makeTranscript(1),
        sidecar,
        modelProfile,
      }),
    ).rejects.toThrow(/^CHUNK_FAILED:0:POST_DECODE_ZOD:/);

    // 2 pass-1 cycles × 3 pass-2 reseeds = 6 pass-2 (grammar) calls; total
    // generations (incl. pass-1) capped at MAX_GEN_PER_CHUNK=8.
    expect(sidecar.calls).toHaveLength(6);
    expect(sidecar.pass1Calls).toHaveLength(2);
  });

  // ─── Route (b) latency decomposition (founder smoke 2026-06-09) ────────────
  // onTelemetry feeds the founder-visible main.log so a finalize wall time can
  // be split into cold-cache / retry / RAM. The IPC route wires it to
  // sessionLog.finalize{Attempt,ChunkDone,Done}; here we assert the event
  // stream shape with a vi.fn collector. Under the 2-pass model (2026-06-14):
  // pass-1 (free-gen) emits an attempt-start (pass:1) but NO 'attempt' record
  // (it is not a callWithGrammar). pass-2 (the structuring call) emits both an
  // attempt-start (pass:2) AND one 'attempt' record. So a happy chunk has 2
  // attempt-starts but 1 'attempt'. The 1st pass-2 seed for lecture chunk 0 is
  // baseSeed(5000) + 1*POST_DECODE_SEED_OFFSET(10000) = 15000.

  describe('onTelemetry callback', () => {
    it('single-chunk happy path emits 1 attempt + 1 chunk-done + 1 finalize-done', async () => {
      const sidecar = mockSidecar({ responses: [makeLectureNoteJson('Sec', 0)] });
      const events: FinalizeTelemetryEvent[] = [];

      await finalizeLecture({
        sessionId: 'tel',
        transcript: makeTranscript(3),
        sidecar,
        modelProfile,
        onTelemetry: (e) => events.push(e),
      });

      // attempt event: ONE pass-2 inner attempt, ok=true, seed = 15000 (pass-2
      // block). pass-1 emits no 'attempt'. outerAttempt = pass-1 index (0).
      const attempts = events.filter((e) => e.kind === 'attempt');
      expect(attempts).toHaveLength(1);
      expect(attempts[0]).toMatchObject({
        kind: 'attempt',
        family: 'lecture',
        chunkIndex: 0,
        totalChunks: 1,
        outerAttempt: 0,
        attempt: 1,
        seed: 15000,
        ok: true,
      });
      expect((attempts[0] as { latencyMs: number }).latencyMs).toBeGreaterThanOrEqual(0);

      // chunk-done: 1 pass-1 cycle, 1 pass-2 inner attempt, no reseeds.
      const chunkDone = events.filter((e) => e.kind === 'chunk-done');
      expect(chunkDone).toHaveLength(1);
      expect(chunkDone[0]).toMatchObject({
        kind: 'chunk-done',
        family: 'lecture',
        chunkIndex: 0,
        totalChunks: 1,
        outerAttempts: 1,
        totalAttempts: 1,
        freshSeedRetries: 0,
        sanitizedTotal: 0,
      });

      // finalize-done: 1 chunk, 1 attempt
      const finalizeDone = events.filter((e) => e.kind === 'finalize-done');
      expect(finalizeDone).toHaveLength(1);
      expect(finalizeDone[0]).toMatchObject({
        kind: 'finalize-done',
        family: 'lecture',
        chunkCount: 1,
        totalAttempts: 1,
        sanitizedTotal: 0,
      });
    });

    it('pass-2 reseed on post-decode ZodError produces 2 attempt events for chunk 0 (1 ok=true→ZOD, 1 ok=true)', async () => {
      // 1st pass-2 emits JSON missing `sections` → callWithGrammar returns
      // ok=true (z.unknown passes), runPostDecodePipeline throws ZodError →
      // reseed pass-2 (SAME prose, +10000 seed block) → 2nd pass-2 valid.
      // Both 'attempt' records are ok=true (the ZodError is post-callWithGrammar).
      const invalidJson = JSON.stringify({
        schemaVersion: 1,
        family: 'lecture',
        title: 'タイトル',
        generatedAt: new Date().toISOString(),
        generatedBy: { model: 'llama-3.2-3b-q4-km', promptVersion: 1 },
        language: 'ja',
        durationSec: 60,
        // missing: sections — Stage 4 throws ZodError
      });
      const sidecar = mockSidecar({ responses: [invalidJson, makeLectureNoteJson('Sec', 0)] });
      const events: FinalizeTelemetryEvent[] = [];

      await finalizeLecture({
        sessionId: 'tel-retry',
        transcript: makeTranscript(3),
        sidecar,
        modelProfile,
        onTelemetry: (e) => events.push(e),
      });

      const attempts = events.filter((e) => e.kind === 'attempt') as Array<
        Extract<FinalizeTelemetryEvent, { kind: 'attempt' }>
      >;
      expect(attempts).toHaveLength(2);
      // Both pass-2 inner attempts return ok=true from callWithGrammar; the
      // first is rejected later by runPostDecodePipeline (POST_DECODE_ZOD).
      expect(attempts[0]!.attempt).toBe(1);
      expect(attempts[0]!.seed).toBe(15000); // p1=0, p2=0 → +1*10000
      expect(attempts[1]!.attempt).toBe(1); // each pass-2 call is maxAttempts=1
      expect(attempts[1]!.seed).toBe(25000); // p1=0, p2=1 → +2*10000

      const chunkDone = events.filter((e) => e.kind === 'chunk-done') as Array<
        Extract<FinalizeTelemetryEvent, { kind: 'chunk-done' }>
      >;
      // pass-2 reseeds against the SAME prose → still ONE pass-1 cycle.
      expect(chunkDone[0]!.outerAttempts).toBe(1);
      expect(chunkDone[0]!.totalAttempts).toBe(2);
      expect(chunkDone[0]!.freshSeedRetries).toBe(0);
    });

    it('pass-1 reseed (pass-2 exhausts the first prose) advances outerAttempts + freshSeedRetries', async () => {
      // 1st prose's 3 pass-2 attempts all emit invalid JSON (missing sections)
      // → POST_DECODE_ZOD each → pass-2 budget exhausted → fresh pass-1 (p1=1) →
      // that prose's 1st pass-2 succeeds. So outerAttempts (pass-1 cycles) = 2.
      const invalidJson = JSON.stringify({
        schemaVersion: 1,
        family: 'lecture',
        title: 'タイトル',
        generatedAt: new Date().toISOString(),
        generatedBy: { model: 'llama-3.2-3b-q4-km', promptVersion: 1 },
        language: 'ja',
        durationSec: 60,
        // missing: sections — Stage 4 throws ZodError
      });
      const validJson = makeLectureNoteJson('セクション', 0);
      // 3 invalid pass-2 (p1=0) then a valid one (p1=1, p2=0).
      const sidecar = mockSidecar({ responses: [invalidJson, invalidJson, invalidJson, validJson] });
      const events: FinalizeTelemetryEvent[] = [];

      await finalizeLecture({
        sessionId: 'tel-outer',
        transcript: makeTranscript(3),
        sidecar,
        modelProfile,
        onTelemetry: (e) => events.push(e),
      });

      const attempts = events.filter((e) => e.kind === 'attempt') as Array<
        Extract<FinalizeTelemetryEvent, { kind: 'attempt' }>
      >;
      expect(attempts).toHaveLength(4); // 3 pass-2 on prose-1 + 1 pass-2 on prose-2
      // outerAttempt tags the pass-1 cycle: first three are p1=0, last is p1=1.
      expect(attempts.slice(0, 3).every((a) => a.outerAttempt === 0)).toBe(true);
      expect(attempts[3]!.outerAttempt).toBe(1);

      const chunkDone = events.filter((e) => e.kind === 'chunk-done') as Array<
        Extract<FinalizeTelemetryEvent, { kind: 'chunk-done' }>
      >;
      expect(chunkDone[0]!.outerAttempts).toBe(2);
      expect(chunkDone[0]!.totalAttempts).toBe(4);
      expect(chunkDone[0]!.freshSeedRetries).toBe(1);
    });

    // ─── attempt-start (finalize progress UI, 2026-06-13; 2-pass 2026-06-14) ──
    // 'attempt'/'chunk-done' fire only AFTER work completes, so the renderer
    // can't show "running now" from them. attempt-start fires at the top of
    // EVERY generation (pass-1 directly, pass-2 via callWithGrammar's
    // onAttemptStart), tagged with `pass`, counted across both passes out of
    // maxAttempts MAX_GEN_PER_CHUNK(8).

    it('emits attempt-start for BOTH passes before the completed attempt event', async () => {
      const sidecar = mockSidecar({ responses: [makeLectureNoteJson('Sec', 0)] });
      const events: FinalizeTelemetryEvent[] = [];

      await finalizeLecture({
        sessionId: 'tel-start',
        transcript: makeTranscript(3),
        sidecar,
        modelProfile,
        onTelemetry: (e) => events.push(e),
      });

      const starts = events.filter((e) => e.kind === 'attempt-start') as Array<
        Extract<FinalizeTelemetryEvent, { kind: 'attempt-start' }>
      >;
      // pass-1 (seed 5000) then pass-2 (seed 15000), counter spans both.
      expect(starts).toHaveLength(2);
      expect(starts[0]).toEqual({
        kind: 'attempt-start',
        family: 'lecture',
        chunkIndex: 0,
        totalChunks: 1,
        attempt: 1,
        maxAttempts: 8,
        seed: 5000,
        pass: 1,
      });
      expect(starts[1]).toEqual({
        kind: 'attempt-start',
        family: 'lecture',
        chunkIndex: 0,
        totalChunks: 1,
        attempt: 2,
        maxAttempts: 8,
        seed: 15000,
        pass: 2,
      });
      // Ordering: the first start precedes the completed 'attempt' record.
      expect(events.findIndex((e) => e.kind === 'attempt-start')).toBeLessThan(
        events.findIndex((e) => e.kind === 'attempt'),
      );
    });

    it('pass-2 reseed numbers attempt-start sequentially across the chunk (1,2,3 of 8)', async () => {
      // 1st pass-2 fails post-decode (missing sections) → reseed pass-2. The
      // attempt-start overall counter increments across pass-1 + both pass-2s.
      const invalidJson = JSON.stringify({
        schemaVersion: 1,
        family: 'lecture',
        title: 'タイトル',
        generatedAt: new Date().toISOString(),
        generatedBy: { model: 'llama-3.2-3b-q4-km', promptVersion: 1 },
        language: 'ja',
        durationSec: 60,
        // missing: sections
      });
      const sidecar = mockSidecar({ responses: [invalidJson, makeLectureNoteJson('Sec', 0)] });
      const events: FinalizeTelemetryEvent[] = [];

      await finalizeLecture({
        sessionId: 'tel-start-retry',
        transcript: makeTranscript(3),
        sidecar,
        modelProfile,
        onTelemetry: (e) => events.push(e),
      });

      const starts = events.filter((e) => e.kind === 'attempt-start') as Array<
        Extract<FinalizeTelemetryEvent, { kind: 'attempt-start' }>
      >;
      expect(starts.map((s) => ({ attempt: s.attempt, seed: s.seed, pass: s.pass }))).toEqual([
        { attempt: 1, seed: 5000, pass: 1 }, // pass-1
        { attempt: 2, seed: 15000, pass: 2 }, // pass-2 p2=0
        { attempt: 3, seed: 25000, pass: 2 }, // pass-2 p2=1 (reseed)
      ]);
      expect(starts.every((s) => s.maxAttempts === 8)).toBe(true);
    });

    it('fresh pass-1 cycle continues the overall attempt-start count', async () => {
      // 3 invalid pass-2 on prose-1 → fresh pass-1 (p1=1) → its 1st pass-2 ok.
      // attempt-start sequence: pass-1, pass-2×3, pass-1, pass-2. Pass-1 of the
      // 2nd cycle uses seed 5000 + PASS1_SEED_OFFSET(40000) = 45000.
      const invalidJson = JSON.stringify({
        schemaVersion: 1,
        family: 'lecture',
        title: 'タイトル',
        generatedAt: new Date().toISOString(),
        generatedBy: { model: 'llama-3.2-3b-q4-km', promptVersion: 1 },
        language: 'ja',
        durationSec: 60,
        // missing: sections
      });
      const sidecar = mockSidecar({
        responses: [invalidJson, invalidJson, invalidJson, makeLectureNoteJson('セクション', 0)],
      });
      const events: FinalizeTelemetryEvent[] = [];

      await finalizeLecture({
        sessionId: 'tel-start-outer',
        transcript: makeTranscript(3),
        sidecar,
        modelProfile,
        onTelemetry: (e) => events.push(e),
      });

      const starts = events.filter((e) => e.kind === 'attempt-start') as Array<
        Extract<FinalizeTelemetryEvent, { kind: 'attempt-start' }>
      >;
      expect(starts.map((s) => ({ attempt: s.attempt, pass: s.pass }))).toEqual([
        { attempt: 1, pass: 1 }, // pass-1 cycle 0
        { attempt: 2, pass: 2 }, // pass-2 p2=0
        { attempt: 3, pass: 2 }, // pass-2 p2=1
        { attempt: 4, pass: 2 }, // pass-2 p2=2
        { attempt: 5, pass: 1 }, // pass-1 cycle 1 (fresh prose)
        { attempt: 6, pass: 2 }, // pass-2 p2=0 on prose-2
      ]);
      // The fresh pass-1 cycle uses the PASS1_SEED_OFFSET block.
      const pass1Starts = starts.filter((s) => s.pass === 1);
      expect(pass1Starts.map((s) => s.seed)).toEqual([5000, 45000]);
    });

    it('omitting onTelemetry is a no-op (no throws, finalize succeeds)', async () => {
      // Negative: explicit guard that the callback is optional.
      const sidecar = mockSidecar({ responses: [makeLectureNoteJson('Sec', 0)] });
      const result = await finalizeLecture({
        sessionId: 'no-tel',
        transcript: makeTranscript(3),
        sidecar,
        modelProfile,
        // onTelemetry omitted
      });
      expect(result.note.family).toBe('lecture');
    });

    it('onTelemetry receives chunk-done even when the chunk throws CHUNK_FAILED (try/finally invariant)', async () => {
      // Founder-relevant: if a chunk explodes we still want the partial timing
      // surfaced so the next session can attribute the failure. Every pass-2
      // emits unparseable text → callWithGrammar ok=false on all of them (fill
      // all 6 so the mock never falls back to a parseable '{}').
      const sidecar = mockSidecar({ responses: Array(6).fill('not json') });
      const onTelemetry = vi.fn();
      await expect(
        finalizeLecture({
          sessionId: 'tel-throw',
          transcript: makeTranscript(1),
          sidecar,
          modelProfile,
          onTelemetry,
        }),
      ).rejects.toThrow(/^CHUNK_FAILED:0:/);

      const calls = onTelemetry.mock.calls.map((c) => c[0] as FinalizeTelemetryEvent);
      // 6 pass-2 inner attempts (2 pass-1 × 3 pass-2), all ok=false; 1 chunk-done;
      // NO finalize-done (we threw).
      const attempts = calls.filter((e) => e.kind === 'attempt');
      expect(attempts).toHaveLength(6);
      expect(attempts.every((e) => (e as { ok: boolean }).ok === false)).toBe(true);
      const chunkDone = calls.filter((e) => e.kind === 'chunk-done');
      expect(chunkDone).toHaveLength(1);
      expect(calls.filter((e) => e.kind === 'finalize-done')).toHaveLength(0);
    });
  });
});

// ─── Language guard at the finalize level (fabrication circuit-breaker) ───────
//
// Production incident 2026-06-11: the 3B emitted memorized ENGLISH boilerplate
// for a Japanese recording — schema-valid, so it shipped. finalize* threads
// `expectedLanguage` (args.language, default 'ja') into callWithGrammar (pass-2),
// AND the 2-pass pass-1 runs its own findLanguageMismatch on the free prose.
// Here pass-1 always serves canned JA prose (the mock), so these tests exercise
// the pass-2 guard: a NOTE_LANGUAGE_MISMATCH reseeds pass-2 against the same
// prose, then a fresh pass-1, exhausting the budget before failing LOUD.
describe('finalizeLecture — NOTE_LANGUAGE_MISMATCH guard', () => {
  /** Schema-valid lecture note whose content is English fabrication (>100
   *  checked chars) — the ONLY tripwire is the language guard. */
  function makeEnglishLectureNoteJson(): string {
    return JSON.stringify({
      schemaVersion: 1,
      family: 'lecture',
      title: 'Introduction to Modern Finance',
      generatedAt: new Date().toISOString(),
      generatedBy: { model: 'llama-3.2-3b-q4-km', promptVersion: 1 },
      language: 'ja',
      durationSec: 1800,
      sections: [
        {
          heading: 'Current Trends in the Finance Industry',
          ts: 0,
          summary:
            'This section discusses the increasing use of digital technologies and the growing importance of sustainability in the modern finance industry.',
          key_terms: [{ term: 'sustainability', definition: 'a generic invented definition', ts: 0 }],
          examples: [],
          points: [{ text: 'There will be a growing focus on digitalization.', ts: 0, important: true }],
        },
      ],
    });
  }

  it('fabricated-English pass-2 attempts reseed, then a JA response succeeds', async () => {
    // pass-1 serves canned JA prose. The first prose's 3 pass-2 attempts each
    // emit English → NOTE_LANGUAGE_MISMATCH → pass-2 reseed; the 3rd exhausts
    // PASS2_MAX_ATTEMPTS_PER_PROSE → fresh pass-1 (p1=1) → its 1st pass-2 serves
    // JA → success. So 4 'attempt' records (3 mismatch + 1 ok), 2 pass-1 cycles.
    const en = makeEnglishLectureNoteJson();
    const sidecar = mockSidecar({
      responses: [en, en, en, makeLectureNoteJson('実際の講義セクション', 0)],
    });
    const events: FinalizeTelemetryEvent[] = [];

    const result = await finalizeLecture({
      sessionId: 'lang-guard-recovers',
      transcript: makeTranscript(3),
      sidecar,
      modelProfile,
      onTelemetry: (e) => events.push(e),
    });

    expect(result.note.sections[0]!.heading).toBe('実際の講義セクション');
    const attempts = events.filter((e) => e.kind === 'attempt') as Array<
      Extract<FinalizeTelemetryEvent, { kind: 'attempt' }>
    >;
    expect(attempts).toHaveLength(4);
    for (const a of attempts.slice(0, 3)) {
      expect(a.ok).toBe(false);
      expect(a.reason).toMatch(/^NOTE_LANGUAGE_MISMATCH/);
    }
    expect(attempts[3]!.ok).toBe(true);
    const chunkDone = events.filter((e) => e.kind === 'chunk-done') as Array<
      Extract<FinalizeTelemetryEvent, { kind: 'chunk-done' }>
    >;
    expect(chunkDone[0]!.outerAttempts).toBe(2);
  });

  it('all-English exhaustion fails LOUD with NOTE_LANGUAGE_MISMATCH in CHUNK_FAILED (never ships fiction)', async () => {
    // Every pass-2 structuring attempt serves grammar-valid English → the
    // callWithGrammar language guard rejects it (NOTE_LANGUAGE_MISMATCH) → pass-2
    // reseed, then fresh pass-1, exhausting all 6 pass-2 (2 pass-1 × 3 pass-2).
    // Fill all 6 so the mock never falls back to '{}' (which would divert the
    // failure into POST_DECODE_ZOD instead). pass-1 here always serves canned JA
    // prose, so the LAST-line defense is the pass-2 guard.
    const sidecar = mockSidecar({ responses: Array(6).fill(makeEnglishLectureNoteJson()) });
    await expect(
      finalizeLecture({
        sessionId: 'lang-guard-exhausts',
        transcript: makeTranscript(3),
        sidecar,
        modelProfile,
      }),
    ).rejects.toThrow(/^CHUNK_FAILED:0:NOTE_LANGUAGE_MISMATCH/);
  });
});

// ─── System/user role split, 2-pass (2026-06-12 → 2026-06-14) ─────────────────
//
// The grammar path previously concatenated system+user into ONE user turn;
// on the real incident transcript that shape produced English fabrication
// while a true system turn produced grounded JA. The 2-pass rewrite keeps the
// role split on BOTH passes: pass-1 (free prose) carries the transcript in its
// user turn with a JA-native system; pass-2 (structuring) carries the pass-1
// prose in its user turn with the structuring system. In neither pass may the
// system text be concatenated into the user prompt.
describe('finalizeLecture — system/user role split (2-pass)', () => {
  it('pass-1 sends the JA-prose system separately + transcript in user; pass-2 sends structuring system separately + prose in user', async () => {
    const sidecar = mockSidecar({ responses: [makeLectureNoteJson('章', 0)] });
    await finalizeLecture({
      sessionId: 'role-split',
      transcript: makeTranscript(3),
      sidecar,
      modelProfile,
    });

    // ── PASS 1: transcript in the user turn, JA-prose system separate ──
    const p1 = sidecar.pass1Calls[0]!;
    expect(p1.system).toBeDefined();
    expect(p1.system!).toContain('日本語'); // JA-native free-prose anchor
    expect(p1.prompt).toContain('Segment 1'); // rendered transcript reaches pass-1
    expect(p1.prompt).not.toContain(p1.system!.slice(0, 40)); // not concatenated

    // ── PASS 2: prose in the user turn, structuring system separate ──
    const p2 = sidecar.calls[0]!;
    expect(p2.system).toBeDefined();
    expect(p2.system!).toMatch(/JSON/); // structuring system mentions the JSON target
    expect(p2.prompt).not.toContain(p2.system!.slice(0, 40)); // not concatenated
    // pass-2 sees the GROUNDED prose, not the raw transcript.
    expect(p2.prompt).toContain('要約'); // the prose-bearing user prefix/body
    expect(p2.prompt).not.toContain('Segment 1');
  });
});

// ─── consolidateLectureSections wiring (rung-1, Task C) ───────────────────────
//
// Verifies that finalizeLecture applies consolidateLectureSections between
// deterministicMerge and fam.schema.parse, capping sections at targetCap.
//
// Strategy: produce 12 chunks via the mock sidecar, each yielding 1 section at
// a different ts with a small gap (10s apart → all within MAX_FOLD_GAP_SEC=300).
// The transcript is short (endTs=14s), so targetCap = max(10, ceil(0.23/8)) = 10.
// deterministicMerge concatenates all 12 sections; consolidation folds down to
// ≤10. The test asserts the cap WITHOUT specifying the exact count (folding is
// deterministic but depends on gap selection — just ≤ targetCap).
describe('finalizeLecture — consolidateLectureSections wiring', () => {
  it('12 merged sections (>targetCap=10) are folded down to ≤10 by consolidation', async () => {
    // 12 chunks, each yielding 1 section at a distinct ts (10s apart).
    // After deterministicMerge the note has 12 sections; consolidation folds
    // to targetCap=10 (transcript endTs=14s → durationMin≈0.23 → targetCap=10).
    const SECTION_COUNT = 12;
    const budget = 5; // forces 1 segment per chunk → 12 chunks from makeTranscript(12)
    const profile = profileWithChunkBudget(budget);
    const responses = Array.from({ length: SECTION_COUNT }, (_, i) =>
      makeLectureNoteJson(`章${i + 1}`, i * 10),
    );
    const sidecar = mockSidecar({ responses });
    const transcript = makeTranscript(SECTION_COUNT);

    const result = await finalizeLecture({
      sessionId: 'consolidation-cap',
      transcript,
      sidecar,
      modelProfile: profile,
    });

    // Exactly 12 sidecar calls (12 chunks, no retries).
    expect(sidecar.calls).toHaveLength(SECTION_COUNT);
    // Core assertion: consolidation has folded 12 → ≤10.
    expect(result.note.sections.length).toBeLessThanOrEqual(10);
    expect(result.note.family).toBe('lecture');
  });

  it('finalize-done telemetry carries consolidation stats for the lecture family', async () => {
    const SECTION_COUNT = 12;
    const budget = 5;
    const profile = profileWithChunkBudget(budget);
    const responses = Array.from({ length: SECTION_COUNT }, (_, i) =>
      makeLectureNoteJson(`章${i + 1}`, i * 10),
    );
    const sidecar = mockSidecar({ responses });
    const transcript = makeTranscript(SECTION_COUNT);
    const events: FinalizeTelemetryEvent[] = [];

    await finalizeLecture({
      sessionId: 'consolidation-tel',
      transcript,
      sidecar,
      modelProfile: profile,
      onTelemetry: (e) => events.push(e),
    });

    const done = events.find((e) => e.kind === 'finalize-done') as
      | Extract<FinalizeTelemetryEvent, { kind: 'finalize-done' }>
      | undefined;
    expect(done).toBeDefined();
    // consolidation field must be present and report targetCap=10 (short transcript).
    expect(done!.consolidation).toBeDefined();
    expect(done!.consolidation!.targetCap).toBe(10);
    // folded > 0: 12 sections > 10 → at least 2 folds.
    expect(done!.consolidation!.folded).toBeGreaterThan(0);
  });
});
