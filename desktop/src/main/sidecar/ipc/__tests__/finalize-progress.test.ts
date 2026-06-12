/**
 * toFinalizeProgressPayload — telemetry → renderer progress mapping.
 *
 * The renderer payload is deliberately MINIMAL: no family/seed/latency and
 * especially no `reason` (failure reasons embed note-content samples, e.g.
 * ESCAPE_LITERAL_AT_<path>:"<40 chars of note text>" — the shape-only PII
 * contract must hold on the renderer channel too). toEqual (not
 * toMatchObject) asserts no extra field can leak through the mapper.
 */
import { describe, it, expect } from 'vitest';
import { toFinalizeProgressPayload } from '../finalize-progress';
import type { FinalizeTelemetryEvent } from '../../orchestrator';

describe('toFinalizeProgressPayload', () => {
  it('maps attempt-start to the minimal renderer payload (no family/seed)', () => {
    const e: FinalizeTelemetryEvent = {
      kind: 'attempt-start',
      family: 'lecture',
      chunkIndex: 1,
      totalChunks: 2,
      attempt: 2,
      maxAttempts: 6,
      seed: 5100,
    };
    expect(toFinalizeProgressPayload(e)).toEqual({
      kind: 'attempt-start',
      chunkIndex: 1,
      totalChunks: 2,
      attempt: 2,
      maxAttempts: 6,
    });
  });

  it('maps chunk-done to chunkIndex/totalChunks only (no latency/attempt counters)', () => {
    const e: FinalizeTelemetryEvent = {
      kind: 'chunk-done',
      family: 'interview',
      chunkIndex: 0,
      totalChunks: 3,
      totalLatencyMs: 81234,
      outerAttempts: 2,
      totalAttempts: 4,
      freshSeedRetries: 1,
      sanitizedTotal: 0,
    };
    expect(toFinalizeProgressPayload(e)).toEqual({
      kind: 'chunk-done',
      chunkIndex: 0,
      totalChunks: 3,
    });
  });

  it('maps finalize-done to a bare kind', () => {
    const e: FinalizeTelemetryEvent = {
      kind: 'finalize-done',
      family: 'lecture',
      totalLatencyMs: 90000,
      chunkCount: 2,
      totalAttempts: 3,
      sanitizedTotal: 1,
    };
    expect(toFinalizeProgressPayload(e)).toEqual({ kind: 'finalize-done' });
  });

  it('drops completed attempt events — its reason field may carry content samples', () => {
    const e: FinalizeTelemetryEvent = {
      kind: 'attempt',
      family: 'lecture',
      chunkIndex: 0,
      totalChunks: 1,
      outerAttempt: 0,
      attempt: 1,
      seed: 5000,
      latencyMs: 1000,
      ok: false,
      reason: 'ESCAPE_LITERAL_AT_$.sections[0].heading:"レジュメ\\u3042"',
    };
    expect(toFinalizeProgressPayload(e)).toBeNull();
  });
});
