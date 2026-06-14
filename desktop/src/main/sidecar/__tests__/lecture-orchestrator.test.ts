/**
 * Tests for finalizeLecture.
 *
 * Lecture runs SINGLE-PASS (per-family wiring, 2026-06-14): structure the
 * transcript DIRECTLY under grammar — the lecture model echoes its own prompt
 * back as garbage when run 2-pass (real-3B validation). So each chunk drives
 * exactly ONE generation per inner attempt (no free-prose pass-1), and lecture
 * pairs this with BESPOKE_SAMPLING (repeatPenalty 1.1, DRY off).
 *
 * Retry ladder (restored from commit eebce31): POST_DECODE_OUTER_ATTEMPTS(2)
 * outer seed blocks × INNER_GRAMMAR_ATTEMPTS(3) inner (+100-stride) retries,
 * then runPostDecodePipeline. ESCAPE_LITERAL / NOTE_LANGUAGE_MISMATCH ⇒ fresh
 * outer block; post-decode ZodError ⇒ fresh outer block.
 *
 * Uses an inline mockSidecar — no shared test-helpers module needed.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import {
  finalizeLecture,
  type FinalizeLectureArgs,
  type FinalizeTelemetryEvent,
} from '../orchestrator';
import type { GrammarCapableSidecar } from '../grammar-call';
import type { SessionTranscript } from '@shared/note-schema/transcript';
import { modelProfiles, BESPOKE_SAMPLING } from '@shared/models/profiles';
import type { ModelProfile } from '@shared/models/profiles';
import type { SamplingParams } from '@shared/ipc-protocol';

// ─── inline mock sidecar ────────────────────────────────────────────────────

type MockOpts = {
  /** Canned JSON strings, one per generation call. Defaults to valid LectureNote JSON. */
  responses?: string[];
  /** call-index → number of failures (rejections) before that call succeeds */
  failuresPerCall?: Record<number, number>;
};

/**
 * Single-pass mock (per-family wiring, 2026-06-14). Lecture ALWAYS sends a
 * grammar (no empty-grammar pass-1 step), so every call is a structuring
 * generation recorded in `calls` and driven by `responses[]` / `failuresPerCall`
 * — `calls.length` equals the number of generations (≈ chunk count + retries),
 * and the seed/JSON/sampling assertions read this single stream.
 */
function mockSidecar(
  opts: MockOpts = {},
): GrammarCapableSidecar & {
  calls: Array<{
    prompt: string;
    system?: string;
    grammar: string;
    seed: number;
    sampling?: SamplingParams;
  }>;
} {
  const responses = opts.responses;
  const failures = opts.failuresPerCall ?? {};
  const calls: Array<{
    prompt: string;
    system?: string;
    grammar: string;
    seed: number;
    sampling?: SamplingParams;
  }> = [];
  let successCallIdx = 0;
  return {
    calls,
    async generateWithGrammar(req) {
      calls.push({
        prompt: req.prompt,
        system: req.system,
        grammar: req.grammar,
        seed: req.seed,
        sampling: req.sampling,
      });
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
  it('1-chunk transcript → exactly 1 generation, note has family=lecture', async () => {
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

  it('the generate envelope carries BESPOKE sampling (penalty 1.1, DRY off)', async () => {
    // Lecture is single-pass + bespoke override; assert the envelope the sidecar
    // actually receives, not just the profile constant.
    const sidecar = mockSidecar({ responses: [makeLectureNoteJson('導入', 0)] });
    await finalizeLecture({
      sessionId: 'bespoke',
      transcript: makeTranscript(3),
      sidecar,
      modelProfile,
    });
    expect(sidecar.calls[0]!.sampling).toEqual(BESPOKE_SAMPLING);
    expect(sidecar.calls[0]!.sampling!.repeatPenalty).toBe(1.1);
    expect(sidecar.calls[0]!.sampling!.dryMultiplier).toBe(0);
  });

  it('3-chunk transcript → exactly 3 generations, ZERO merge-LLM calls', async () => {
    // budget=5 forces 1 segment per ~7-token chunk → 3 chunks from makeTranscript(3).
    const budget = 5;
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

    // Exactly 3 generations (Lecture = no merge-LLM call)
    expect(sidecar.calls).toHaveLength(3);
    expect(result.telemetry.chunkCount).toBe(3);
    expect(result.note.family).toBe('lecture');
    // All 3 sections should be in the merged note (concat-only + sortByTs)
    expect(result.note.sections.length).toBe(3);
  });

  it('retry budget: chunk-0 fails once → total generations = 4', async () => {
    // Same 3-chunk setup as above
    const budget = 5;
    const profile = profileWithChunkBudget(budget);
    const transcript = makeTranscript(3);
    const responses = [
      makeLectureNoteJson('章 1', 0),
      makeLectureNoteJson('章 2', 5),
      makeLectureNoteJson('章 3', 10),
    ];
    // successCallIdx 0 fails once before succeeding (inner +100 retry).
    const sidecar = mockSidecar({ responses, failuresPerCall: { 0: 1 } });

    const args: FinalizeLectureArgs = {
      sessionId: 'test',
      transcript,
      sidecar,
      modelProfile: profile,
    };

    const result = await finalizeLecture(args);

    // 1 failure (chunk-0 inner attempt 1) + 1 success (chunk-0 inner attempt 2) +
    // 1 success (chunk-1) + 1 success (chunk-2) = 4 total generations
    expect(sidecar.calls).toHaveLength(4);
    expect(result.note.family).toBe('lecture');
    expect(result.note.sections.length).toBe(3);
  });

  it('throws CHUNK_FAILED when a chunk exhausts all inner retry attempts', async () => {
    const sidecar = mockSidecar({
      responses: [],                       // never consulted — every attempt fails
      failuresPerCall: { 0: 99 },          // chunk 0 fails every attempt
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

  // ─── outer retry on post-decode ZodError (single-pass) ───────────────────────
  // callWithGrammar receives `schema: z.unknown()` (pass-through), so its
  // per-attempt retry-on-Zod contract no-ops for the real family shape. The
  // family.schema.parse() runs inside runPostDecodePipeline (Stage 4) AFTER
  // callWithGrammar returns ok=true. Without an outer retry, a single bad
  // emission burns the whole chunk and propagates ZodError out of
  // finalizeLecture with no recovery. The single-pass ladder wraps the
  // callWithGrammar call in an outer retry loop with a disjoint seed-block
  // (+10000) per outer attempt.

  it('retries chunk with fresh seed block when runPostDecodePipeline throws ZodError', async () => {
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
      sessionId: 'zod-retry',
      transcript: makeTranscript(3),  // 3 segs at default budget → 1 chunk
      sidecar,
      modelProfile,
    });

    // Two sidecar calls: outer attempt 0 produced invalid JSON (1 inner
    // attempt that ok=true but failed post-decode), outer attempt 1 valid.
    expect(sidecar.calls).toHaveLength(2);
    // The outer retry advances baseSeed by a block strictly larger than
    // callWithGrammar's inner stride (+0/+100/+200), so the second outer
    // attempt's first inner seed cannot collide with the first attempt's
    // inner retries. >200 is the load-bearing guarantee.
    expect(sidecar.calls[1]!.seed).toBeGreaterThan(sidecar.calls[0]!.seed + 200);
    expect(result.note.family).toBe('lecture');
    expect(result.note.sections.length).toBe(1);
  });

  it('throws CHUNK_FAILED:POST_DECODE_ZOD when post-decode fails on every outer block', async () => {
    // Every generation emits JSON missing `sections` → Stage 4 ZodError on
    // each → fresh outer block, until POST_DECODE_OUTER_ATTEMPTS exhausted.
    // The mock falls back to '{}' after the two scripted responses, which is
    // also missing sections → still POST_DECODE_ZOD. Outer-0's first inner
    // attempt ok=true+ZOD → break to next outer (no inner reseed: the ZodError
    // is post-callWithGrammar), so 1 generation per outer block × 2 = 2 calls.
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
        sessionId: 'zod-exhaust',
        transcript: makeTranscript(1),
        sidecar,
        modelProfile,
      }),
    ).rejects.toThrow(/^CHUNK_FAILED:0:POST_DECODE_ZOD:/);

    // 2 outer blocks, each ok=true on its first inner attempt then ZOD → 2 calls.
    expect(sidecar.calls).toHaveLength(2);
  });

  // ─── Route (b) latency decomposition (founder smoke 2026-06-09) ────────────
  // onTelemetry feeds the founder-visible main.log so a finalize wall time can
  // be split into cold-cache / retry / RAM. The IPC route wires it to
  // sessionLog.finalize{Attempt,ChunkDone,Done}; here we assert the event
  // stream shape with a vi.fn collector. Single-pass (2026-06-14): every
  // generation is a callWithGrammar inner attempt — it emits BOTH an
  // attempt-start (no `pass` tag) AND one 'attempt' record. So a happy chunk
  // has exactly 1 attempt-start + 1 'attempt'. Lecture chunk-0 baseSeed=5000;
  // the first inner seed is 5000.

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

      // attempt event: ONE inner attempt, ok=true, seed = 5000 (baseSeed).
      // outerAttempt = single-pass outer-block index (0).
      const attempts = events.filter((e) => e.kind === 'attempt');
      expect(attempts).toHaveLength(1);
      expect(attempts[0]).toMatchObject({
        kind: 'attempt',
        family: 'lecture',
        chunkIndex: 0,
        totalChunks: 1,
        outerAttempt: 0,
        attempt: 1,
        seed: 5000,
        ok: true,
      });
      expect((attempts[0] as { latencyMs: number }).latencyMs).toBeGreaterThanOrEqual(0);

      // chunk-done: 1 outer block, 1 inner attempt, no reseeds.
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

    it('outer-block retry on post-decode ZodError produces 2 attempt events for chunk 0', async () => {
      // 1st generation emits JSON missing `sections` → callWithGrammar returns
      // ok=true (z.unknown passes), runPostDecodePipeline throws ZodError →
      // fresh outer block (+10000 seed) → 2nd generation valid. Both 'attempt'
      // records are ok=true (the ZodError is post-callWithGrammar).
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
      // Both inner attempts return ok=true from callWithGrammar; the first is
      // rejected later by runPostDecodePipeline (POST_DECODE_ZOD).
      expect(attempts[0]!.attempt).toBe(1);
      expect(attempts[0]!.seed).toBe(5000); // outer 0, inner 1 → baseSeed
      expect(attempts[1]!.attempt).toBe(1); // outer 1's first inner attempt
      expect(attempts[1]!.outerAttempt).toBe(1);
      expect(attempts[1]!.seed).toBe(15000); // outer 1 → +1*10000

      const chunkDone = events.filter((e) => e.kind === 'chunk-done') as Array<
        Extract<FinalizeTelemetryEvent, { kind: 'chunk-done' }>
      >;
      // 2 outer blocks ran (fresh seed each) → outerAttempts=2, freshSeedRetries=1.
      expect(chunkDone[0]!.outerAttempts).toBe(2);
      expect(chunkDone[0]!.totalAttempts).toBe(2);
      expect(chunkDone[0]!.freshSeedRetries).toBe(1);
    });

    // ─── attempt-start (finalize progress UI, 2026-06-13; single-pass 2026-06-14) ──
    // 'attempt'/'chunk-done' fire only AFTER work completes, so the renderer
    // can't show "running now" from them. attempt-start fires at the top of
    // EVERY generation (via callWithGrammar's onAttemptStart), with NO `pass`
    // tag for single-pass, counted across outer×inner out of maxAttempts
    // POST_DECODE_OUTER_ATTEMPTS(2)×INNER_GRAMMAR_ATTEMPTS(3)=6.

    it('emits attempt-start (no pass tag) before the completed attempt event', async () => {
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
      // One generation → one attempt-start. Single-pass omits `pass`.
      expect(starts).toHaveLength(1);
      expect(starts[0]).toEqual({
        kind: 'attempt-start',
        family: 'lecture',
        chunkIndex: 0,
        totalChunks: 1,
        attempt: 1,
        maxAttempts: 6,
        seed: 5000,
      });
      expect(starts[0]!.pass).toBeUndefined();
      // Ordering: the start precedes the completed 'attempt' record.
      expect(events.findIndex((e) => e.kind === 'attempt-start')).toBeLessThan(
        events.findIndex((e) => e.kind === 'attempt'),
      );
    });

    it('inner reseed numbers attempt-start sequentially within an outer block (1,2 of 6)', async () => {
      // 1st inner attempt is a hard rejection (mock-fail) → callWithGrammar
      // reseeds +100 → 2nd inner attempt succeeds. The attempt-start overall
      // counter increments across inner attempts (1,2) within outer block 0.
      const sidecar = mockSidecar({
        responses: [makeLectureNoteJson('Sec', 0)],
        failuresPerCall: { 0: 1 }, // first generation rejects, second succeeds
      });
      const events: FinalizeTelemetryEvent[] = [];

      await finalizeLecture({
        sessionId: 'tel-start-inner',
        transcript: makeTranscript(3),
        sidecar,
        modelProfile,
        onTelemetry: (e) => events.push(e),
      });

      const starts = events.filter((e) => e.kind === 'attempt-start') as Array<
        Extract<FinalizeTelemetryEvent, { kind: 'attempt-start' }>
      >;
      expect(starts.map((s) => ({ attempt: s.attempt, seed: s.seed }))).toEqual([
        { attempt: 1, seed: 5000 }, // outer 0, inner 1
        { attempt: 2, seed: 5100 }, // outer 0, inner 2 (+100 reseed)
      ]);
      expect(starts.every((s) => s.maxAttempts === 6)).toBe(true);
      expect(starts.every((s) => s.pass === undefined)).toBe(true);
    });

    it('fresh outer block continues the overall attempt-start count across the +10000 block', async () => {
      // Outer 0's single inner attempt is ok=true but fails post-decode (missing
      // sections) → fresh outer block. Outer 1's first inner attempt succeeds.
      // attempt-start sequence spans both outer blocks: attempt 1 (seed 5000),
      // attempt 2 (seed 15000).
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
        responses: [invalidJson, makeLectureNoteJson('セクション', 0)],
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
      expect(starts.map((s) => ({ attempt: s.attempt, seed: s.seed }))).toEqual([
        { attempt: 1, seed: 5000 },  // outer block 0, inner 1
        { attempt: 4, seed: 15000 }, // outer block 1, inner 1 (overall counter = 1*3 + 1)
      ]);
      expect(starts.every((s) => s.maxAttempts === 6)).toBe(true);
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
      // surfaced so the next session can attribute the failure. Every generation
      // emits unparseable text → callWithGrammar ok=false (SyntaxError) on all
      // INNER attempts. A generic (non-ESCAPE/non-LANG) failure does NOT earn a
      // fresh outer block (eebce31 single-pass semantics), so the chunk fails
      // after outer block 0's 3 inner attempts → 3 'attempt' records.
      const sidecar = mockSidecar({ responses: Array(3).fill('not json') });
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
      // 3 inner attempts (outer block 0 only), all ok=false; 1 chunk-done;
      // NO finalize-done (we threw).
      const attempts = calls.filter((e) => e.kind === 'attempt');
      expect(attempts).toHaveLength(3);
      expect(attempts.every((e) => (e as { ok: boolean }).ok === false)).toBe(true);
      const chunkDone = calls.filter((e) => e.kind === 'chunk-done');
      expect(chunkDone).toHaveLength(1);
      // Only outer block 0 ran (generic failure → no fresh outer block).
      expect((chunkDone[0] as { outerAttempts: number }).outerAttempts).toBe(1);
      expect(calls.filter((e) => e.kind === 'finalize-done')).toHaveLength(0);
    });
  });
});

// ─── Language guard at the finalize level (fabrication circuit-breaker) ───────
//
// Production incident 2026-06-11: the 3B emitted memorized ENGLISH boilerplate
// for a Japanese recording — schema-valid, so it shipped. Lecture (single-pass)
// threads `expectedLanguage` (args.language, default 'ja') into callWithGrammar,
// which runs findLanguageMismatch on every generation. A NOTE_LANGUAGE_MISMATCH
// gets a fresh outer seed block; exhausting all outer blocks fails LOUD instead
// of shipping fiction.
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

  it('fabricated-English generation reseeds (fresh outer block), then a JA response succeeds', async () => {
    // Outer block 0: all 3 inner attempts emit English → NOTE_LANGUAGE_MISMATCH
    // each (callWithGrammar inner +100 reseeds) → ok=false → fresh outer block.
    // Outer block 1's 1st inner attempt serves JA → success. So 4 'attempt'
    // records (3 mismatch in outer-0 + 1 ok in outer-1), 2 outer blocks.
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
    // Every generation serves grammar-valid English → the callWithGrammar
    // language guard rejects it (NOTE_LANGUAGE_MISMATCH) on all 6 inner attempts
    // (2 outer × 3 inner). Fill all 6 so the mock never falls back to '{}'.
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

// ─── System/user role split, single-pass (2026-06-14) ─────────────────────────
//
// Lecture is single-pass: it structures the transcript DIRECTLY under grammar.
// The system turn (the lecture variant's JA-native systemTemplate) MUST be sent
// as a true `system` role, NOT concatenated into the user turn — the role split
// is the fix that turned English fabrication into grounded JA on the real
// incident transcript. The user turn carries the rendered transcript.
describe('finalizeLecture — system/user role split (single-pass)', () => {
  it('sends the lecture system separately + the transcript in the user turn (not concatenated)', async () => {
    const sidecar = mockSidecar({ responses: [makeLectureNoteJson('章', 0)] });
    await finalizeLecture({
      sessionId: 'role-split',
      transcript: makeTranscript(3),
      sidecar,
      modelProfile,
    });

    const call = sidecar.calls[0]!;
    // System turn present + carries the JA-native lecture system (mentions JSON).
    expect(call.system).toBeDefined();
    expect(call.system!).toContain('日本語'); // JA-native anchor
    expect(call.system!).toMatch(/JSON/);     // structuring target named in the system
    // User turn carries the rendered transcript (single-pass feeds the model the
    // transcript directly) and is NOT a concatenation of the system text.
    expect(call.prompt).toContain('Segment 1');
    expect(call.prompt).toContain('Transcript:');
    expect(call.prompt).not.toContain(call.system!.slice(0, 40));
    // Grammar IS attached (single-pass always structures under grammar).
    expect(call.grammar.length).toBeGreaterThan(0);
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
