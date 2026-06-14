/**
 * 30-minute Lecture stress test (MOCKED leg) — verifies the founder
 * principle (2026-06-09):
 *
 *   "쪼개서 진행하도록 했으니 녹음이 길어져도 시간만 조금 더 걸릴 뿐
 *    불가능하진 않아야"
 *
 * finalizeLecture must chunk a long transcript via the PRODUCTION default
 * 3000-token budget (NOT a test-only override) and merge all chunks into
 * a valid LectureNote. A 30-min recording should just take longer, not
 * structurally break.
 *
 * Three mocked logic tests (runs in CI on every push):
 *   (a) chunkTranscript splits the 45-min synth into exactly
 *       EXPECTED_CHUNKS_AT_DEFAULT=4 at the production 3000-token budget.
 *       Pinned literal, NOT recomputed from chunkTranscript itself
 *       (would be circular).
 *   (b) finalizeLecture e2e via mock sidecar: one distinct heading per
 *       chunk → assert sections.length === 4, EXACT-SET equality of
 *       headings (catches "later chunks silently dropped" subset case,
 *       not just total collapse), sections sorted by ts, schema valid,
 *       telemetry.chunkCount = 4, seed-per-chunk = 5000+i (no spurious
 *       outer retry on healthy responses).
 *   (c) bad-middle-chunk: healthy first chunk + malformed second →
 *       assert CHUNK_FAILED:1 throw. Proves the orchestrator does NOT
 *       silently swallow a mid-stream failure as success.
 *
 * Wall-time fidelity (with the real 3B sidecar) is covered by the sibling
 * `lecture-30min-stress.real.test.ts` (env-gated).
 *
 * Per `pitfalls.md (vitest-scope)` — run by EXPLICIT FILE PATH only.
 */
import { describe, it, expect } from 'vitest';

import { finalizeLecture } from '../main/sidecar/orchestrator';
import { chunkTranscript } from '../shared/note-schema/chunking';
import { LectureNoteSchema } from '../shared/families/lecture/schema';
import { modelProfiles } from '../shared/models/profiles';
import '../shared/families/lecture/core'; // side-effect: register LectureFamilyCore

import {
  EXPECTED_CHUNKS_AT_DEFAULT,
  PROD_LECTURE_BUDGET,
  makeSynthetic30MinTranscript,
  makeLectureNoteJson,
  mockSidecarPerChunk,
} from './lecture-30min-stress.helpers';

describe('finalizeLecture 30-min stress (mocked)', () => {
  it('(a) chunkTranscript splits the synth into exactly EXPECTED_CHUNKS at default 3000-token budget', () => {
    // The PRODUCTION default — NOT a test-only override. Catches BOTH a
    // chunker regression AND a synth-density drift. Pin to literal so the
    // e2e tests below can reuse without circular reasoning.
    const transcript = makeSynthetic30MinTranscript();
    const chunks = chunkTranscript(transcript, PROD_LECTURE_BUDGET);
    expect(chunks.length).toBe(EXPECTED_CHUNKS_AT_DEFAULT);
  });

  it('(b) finalizeLecture: every chunk processed, all headings preserved through merge', async () => {
    // One distinct heading per chunk so we can prove ALL chunks contributed
    // to the merged note (not just the first).
    const headings = Array.from(
      { length: EXPECTED_CHUNKS_AT_DEFAULT },
      (_, i) => `章${i + 1}`,
    );
    const responses = headings.map((h, i) => makeLectureNoteJson(h, i * 900));
    const sidecar = mockSidecarPerChunk(responses);

    const result = await finalizeLecture({
      sessionId: 'stress-mock',
      transcript: makeSynthetic30MinTranscript(),
      sidecar,
      modelProfile: modelProfiles['llama-3.2-3b-q4-km']!,
    });

    // Chunker fired the expected number of times. Pinned to the literal,
    // not recomputed from chunkTranscript (would be circular).
    expect(sidecar.calls.length).toBe(EXPECTED_CHUNKS_AT_DEFAULT);

    // Every healthy canned response = exactly 1 attempt; no spurious retry.
    expect(result.telemetry.chunkCount).toBe(EXPECTED_CHUNKS_AT_DEFAULT);

    // Merged note: exactly one section per chunk, ALL distinct headings
    // present (exact set equality catches any chunk being silently dropped,
    // not just total collapse to one).
    expect(result.note.sections.length).toBe(EXPECTED_CHUNKS_AT_DEFAULT);
    expect(new Set(result.note.sections.map((s) => s.heading))).toEqual(
      new Set(headings),
    );

    // Sections must remain sorted by ts after deterministicMerge.sortByTs.
    const tsSequence = result.note.sections.map((s) => s.ts);
    expect(tsSequence).toEqual([...tsSequence].sort((a, b) => a - b));

    // Schema parse passes — the canned shape is faithful.
    expect(() => LectureNoteSchema.parse(result.note)).not.toThrow();

    // Per-chunk seed assertion (2-pass, 2026-06-14): no pass-1 reseed must
    // fire on healthy responses — each chunk's PASS-1 seed is the lecture
    // family base 5000 + i (mirror orchestrator.ts). Exactly one pass-1 per
    // chunk (no ran-to-cap / language-mismatch reseed).
    expect(sidecar.pass1Calls.length).toBe(EXPECTED_CHUNKS_AT_DEFAULT);
    sidecar.pass1Calls.forEach((call, i) => {
      expect(call.seed).toBe(5000 + i);
    });
  });

  it('(c) bad middle chunk: orchestrator propagates CHUNK_FAILED, does not silently swallow', async () => {
    // Healthy response, then a malformed one (missing required `sections`).
    // Must throw CHUNK_FAILED for the bad chunk — never silently merge a
    // partial result that drops a chunk's content.
    const responses = [
      makeLectureNoteJson('章1', 0),
      JSON.stringify({
        schemaVersion: 1,
        family: 'lecture',
        title: 'テスト講義',
        generatedAt: new Date().toISOString(),
        generatedBy: { model: 'llama-3.2-3b-q4-km', promptVersion: 1 },
        language: 'ja',
        durationSec: 1800,
        // missing: sections — runPostDecodePipeline Stage 4 throws ZodError
      }),
    ];
    const sidecar = mockSidecarPerChunk(responses);

    await expect(
      finalizeLecture({
        sessionId: 'stress-mock-bad-middle',
        transcript: makeSynthetic30MinTranscript(),
        sidecar,
        modelProfile: modelProfiles['llama-3.2-3b-q4-km']!,
      }),
    ).rejects.toThrow(/^CHUNK_FAILED:1:/);
  });
});
