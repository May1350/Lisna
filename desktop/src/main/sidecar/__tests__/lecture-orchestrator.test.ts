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
  /** Canned JSON strings, one per successful call. Defaults to valid LectureNote JSON. */
  responses?: string[];
  /** call-index → number of failures before that call succeeds */
  failuresPerCall?: Record<number, number>;
};

function mockSidecar(
  opts: MockOpts = {},
): GrammarCapableSidecar & { calls: Array<{ prompt: string; system?: string; grammar: string; seed: number }> } {
  const responses = opts.responses;
  const failures = opts.failuresPerCall ?? {};
  const calls: Array<{ prompt: string; system?: string; grammar: string; seed: number }> = [];
  let successCallIdx = 0;
  return {
    calls,
    async generateWithGrammar(req) {
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

  it('throws CHUNK_FAILED:POST_DECODE_ZOD_EXHAUSTED when post-decode fails on both outer attempts', async () => {
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
    ).rejects.toThrow(/^CHUNK_FAILED:0:POST_DECODE_ZOD_EXHAUSTED/);

    expect(sidecar.calls).toHaveLength(2);
  });

  // ─── Route (b) latency decomposition (founder smoke 2026-06-09) ────────────
  // onTelemetry feeds the founder-visible main.log so a finalize wall time can
  // be split into cold-cache / retry / RAM. The IPC route wires it to
  // sessionLog.finalize{Attempt,ChunkDone,Done}; here we assert the event
  // stream shape with a vi.fn collector.

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

      // attempt event: 1 inner attempt, ok=true, seed matches the lecture base (5000+0+0)
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

      // chunk-done: 1 inner attempt total, no retries, no sanitized
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

    it('inner-retry on generator throw produces 2 attempt events for chunk 0 (1 ok=false, 1 ok=true)', async () => {
      // failuresPerCall {0:1} → first generate call throws → callWithGrammar
      // catches as a failed inner attempt and retries with seed+100.
      const sidecar = mockSidecar({
        responses: [makeLectureNoteJson('Sec', 0)],
        failuresPerCall: { 0: 1 },
      });
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
      expect(attempts[0]!.ok).toBe(false);
      expect(attempts[0]!.attempt).toBe(1);
      expect(attempts[0]!.seed).toBe(5000);
      expect(attempts[0]!.reason).toBe('mock-fail');
      expect(attempts[1]!.ok).toBe(true);
      expect(attempts[1]!.attempt).toBe(2);
      expect(attempts[1]!.seed).toBe(5100);

      const chunkDone = events.filter((e) => e.kind === 'chunk-done') as Array<
        Extract<FinalizeTelemetryEvent, { kind: 'chunk-done' }>
      >;
      expect(chunkDone[0]!.outerAttempts).toBe(1);
      expect(chunkDone[0]!.totalAttempts).toBe(2);
      expect(chunkDone[0]!.freshSeedRetries).toBe(0); // inner retry, not outer
    });

    it('outer post-decode retry advances outerAttempts and freshSeedRetries', async () => {
      // Reuses the P0b setup: outer attempt 0 produces JSON missing 'sections'
      // (post-decode ZodError) → outer attempt 1 with +10000 seed block succeeds.
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
      const sidecar = mockSidecar({ responses: [invalidJson, validJson] });
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
      expect(attempts).toHaveLength(2);
      // outer 0, inner 1: ok=true (JSON parses + sanitize passes — fails LATER in post-decode)
      expect(attempts[0]!.outerAttempt).toBe(0);
      expect(attempts[0]!.ok).toBe(true);
      // outer 1, inner 1: ok=true on the valid JSON
      expect(attempts[1]!.outerAttempt).toBe(1);
      expect(attempts[1]!.ok).toBe(true);

      const chunkDone = events.filter((e) => e.kind === 'chunk-done') as Array<
        Extract<FinalizeTelemetryEvent, { kind: 'chunk-done' }>
      >;
      expect(chunkDone[0]!.outerAttempts).toBe(2);
      expect(chunkDone[0]!.totalAttempts).toBe(2);
      expect(chunkDone[0]!.freshSeedRetries).toBe(1);
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
      // surfaced so the next session can attribute the failure.
      const sidecar = mockSidecar({
        responses: [],
        failuresPerCall: { 0: 5 }, // exhausts inner retries (maxAttempts=3) on first outer
      });
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
      // 3 inner attempts (all ok=false) + 1 chunk-done; NO finalize-done (we threw).
      const attempts = calls.filter((e) => e.kind === 'attempt');
      expect(attempts).toHaveLength(3);
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
// `expectedLanguage` (args.language, default 'ja') into callWithGrammar, and
// runChunkWithGrammar's outer-retry treats NOTE_LANGUAGE_MISMATCH like
// ESCAPE_LITERAL_AT_ (fresh +10000 seed block before failing the chunk).
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

  it('fabricated-English chunks burn inner+outer retries, then a JA response succeeds', async () => {
    // Inner ladder (maxAttempts=3) rejects 3 English attempts on outer 0 →
    // NOTE_LANGUAGE_MISMATCH finalReason → outer predicate continues → outer 1
    // serves JA → success.
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
    // Every attempt (3 inner × POST_DECODE_OUTER_ATTEMPTS=2 outer) must serve
    // English — the mock falls back to '{}' when responses run out, which
    // would divert the failure into the POST_DECODE_ZOD path instead.
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

// ─── System/user role split at the finalize level (2026-06-12) ────────────────
//
// The grammar path previously concatenated system+user into ONE user turn;
// on the real incident transcript that shape produced English fabrication
// while a true system turn produced grounded JA (groundingJa 0.95, same v1
// prompt, llama-completion --jinja -sys). finalize* must pass the rendered
// system template as `system` and ONLY the chunk user template as `prompt`.
describe('finalizeLecture — system/user role split', () => {
  it('sends the system template as a separate system turn, transcript in the user turn', async () => {
    const sidecar = mockSidecar({ responses: [makeLectureNoteJson('章', 0)] });
    await finalizeLecture({
      sessionId: 'role-split',
      transcript: makeTranscript(3),
      sidecar,
      modelProfile,
    });
    const call = sidecar.calls[0]!;
    expect(call.system).toBeDefined();
    // System turn = the lecture system template (identifying marker), and it
    // must NOT leak into the user prompt anymore.
    expect(call.system!).toContain('LectureNote');
    expect(call.prompt).not.toContain(call.system!.slice(0, 40));
    // User turn = chunk header + rendered transcript.
    expect(call.prompt).toMatch(/Chunk 1 of 1/);
    expect(call.prompt).toContain('Transcript:');
  });
});
