/**
 * applyFinalizeProgress — pure reducer mapping main-pushed
 * FinalizeProgressPayload events onto the curatingV2 ProgressState.
 *
 * Every transition is driven by a REAL telemetry event (founder constraint:
 * no simulated progress). `startedAt` is renderer-clock state set when
 * curatingV2 mounts and must survive every transition — it feeds the
 * elapsed-time line.
 */
import { describe, it, expect } from 'vitest';
import { applyFinalizeProgress } from '../App';
import type { ProgressState } from '../components/NoteRenderProgress';

const START = 1_700_000_000_000;

describe('applyFinalizeProgress', () => {
  it('attempt-start enters the chunk phase with attempt counters, preserving startedAt', () => {
    const prev: ProgressState = { phase: 'loading', startedAt: START };
    expect(
      applyFinalizeProgress(prev, {
        kind: 'attempt-start', chunkIndex: 0, totalChunks: 2, attempt: 1, maxAttempts: 6,
      }),
    ).toEqual({
      phase: 'chunk', chunkIndex: 0, totalChunks: 2, attempt: 1, attemptMax: 6, startedAt: START,
    });
  });

  it('a retry attempt-start replaces the attempt counter in place', () => {
    const prev: ProgressState = {
      phase: 'chunk', chunkIndex: 0, totalChunks: 2, attempt: 1, attemptMax: 6, startedAt: START,
    };
    expect(
      applyFinalizeProgress(prev, {
        kind: 'attempt-start', chunkIndex: 0, totalChunks: 2, attempt: 2, maxAttempts: 6,
      }),
    ).toEqual({
      phase: 'chunk', chunkIndex: 0, totalChunks: 2, attempt: 2, attemptMax: 6, startedAt: START,
    });
  });

  it('mid-run chunk-done advances to the next chunk and clears the attempt counter', () => {
    const prev: ProgressState = {
      phase: 'chunk', chunkIndex: 0, totalChunks: 3, attempt: 2, attemptMax: 6, startedAt: START,
    };
    expect(
      applyFinalizeProgress(prev, { kind: 'chunk-done', chunkIndex: 0, totalChunks: 3 }),
    ).toEqual({ phase: 'chunk', chunkIndex: 1, totalChunks: 3, startedAt: START });
  });

  it('last chunk-done of a multi-chunk run enters the merge phase', () => {
    const prev: ProgressState = {
      phase: 'chunk', chunkIndex: 2, totalChunks: 3, startedAt: START,
    };
    expect(
      applyFinalizeProgress(prev, { kind: 'chunk-done', chunkIndex: 2, totalChunks: 3 }),
    ).toEqual({ phase: 'merge', startedAt: START });
  });

  it('last chunk-done of a single-chunk run keeps the current state (no merge step exists)', () => {
    const prev: ProgressState = {
      phase: 'chunk', chunkIndex: 0, totalChunks: 1, attempt: 2, attemptMax: 6, startedAt: START,
    };
    expect(
      applyFinalizeProgress(prev, { kind: 'chunk-done', chunkIndex: 0, totalChunks: 1 }),
    ).toBe(prev);
  });

  it('finalize-done enters the persist phase, preserving startedAt', () => {
    const prev: ProgressState = { phase: 'merge', startedAt: START };
    expect(applyFinalizeProgress(prev, { kind: 'finalize-done' })).toEqual({
      phase: 'persist', startedAt: START,
    });
  });

  it('tolerates a null previous state (event raced ahead of the mount default)', () => {
    expect(
      applyFinalizeProgress(null, {
        kind: 'attempt-start', chunkIndex: 0, totalChunks: 1, attempt: 1, maxAttempts: 6,
      }),
    ).toEqual({
      phase: 'chunk', chunkIndex: 0, totalChunks: 1, attempt: 1, attemptMax: 6, startedAt: undefined,
    });
  });

  // STT Phase 2a — whole-file transcription precedes note generation.
  it('transcribe-start enters the transcribing phase with NO fabricated pct, preserving startedAt', () => {
    const prev: ProgressState = { phase: 'loading', startedAt: START };
    const next = applyFinalizeProgress(prev, { kind: 'transcribe-start' });
    expect(next).toEqual({ phase: 'transcribing', startedAt: START });
    // No-fake-progress founder rule: transcribe-start must not invent a pct.
    expect(next?.pct).toBeUndefined();
  });

  it('transcribe-progress carries the real pct and preserves startedAt', () => {
    const prev: ProgressState = { phase: 'transcribing', startedAt: START };
    expect(
      applyFinalizeProgress(prev, { kind: 'transcribe-progress', pct: 42 }),
    ).toEqual({ phase: 'transcribing', pct: 42, startedAt: START });
  });

  it('transcribe-done falls back to the loading phase (LLM loads next), preserving startedAt', () => {
    const prev: ProgressState = { phase: 'transcribing', pct: 100, startedAt: START };
    expect(
      applyFinalizeProgress(prev, { kind: 'transcribe-done' }),
    ).toEqual({ phase: 'loading', startedAt: START });
  });
});
