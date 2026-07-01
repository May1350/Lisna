/**
 * applyBackgroundProgress — pure reducer folding main-pushed
 * FinalizeProgressPayload events onto the BackgroundJob's progress (Task 6).
 *
 * Unlike the old applyFinalizeProgress-into-`view` path (gated on view.kind ===
 * 'curatingV2'), this folds UNCONDITIONALLY into the backgroundJob axis so a
 * generation's progress lands while the foreground view is `recording`
 * (scenario 2). Settled jobs (done/error) ignore trailing events. No DOM env in
 * this package's vitest config, so only the pure reducer is unit-tested; the
 * effect wiring + chip are verified in-app (T10).
 */
import { describe, it, expect } from 'vitest';
import { applyBackgroundProgress, type BackgroundJob } from '../App';

const START = 1_700_000_000_000;

describe('applyBackgroundProgress', () => {
  it('folds a note job\'s progress while running (attempt-start → chunk phase)', () => {
    const prev: BackgroundJob = { kind: 'note', status: 'running', progress: { phase: 'loading', startedAt: START } };
    expect(
      applyBackgroundProgress(prev, { kind: 'attempt-start', chunkIndex: 0, totalChunks: 2, attempt: 1, maxAttempts: 6 }),
    ).toEqual({
      kind: 'note', status: 'running',
      progress: { phase: 'chunk', chunkIndex: 0, totalChunks: 2, attempt: 1, attemptMax: 6, startedAt: START },
    });
  });

  it('folds a transcript job\'s progress (transcribe-progress pct), preserving kind/status', () => {
    const prev: BackgroundJob = { kind: 'transcript', status: 'running', progress: { phase: 'transcribing', startedAt: START } };
    expect(
      applyBackgroundProgress(prev, { kind: 'transcribe-progress', pct: 42 }),
    ).toEqual({
      kind: 'transcript', status: 'running',
      progress: { phase: 'transcribing', pct: 42, startedAt: START },
    });
  });

  it('folds regardless of foreground view — the reducer has no view gate (scenario 2)', () => {
    // The whole point of the backgroundJob axis: progress is NOT dropped while
    // the foreground is `recording`. The pure reducer proves this structurally —
    // it folds any running job with no reference to `view`.
    const prev: BackgroundJob = { kind: 'note', status: 'running', progress: null };
    const next = applyBackgroundProgress(prev, { kind: 'transcribe-start' });
    expect(next?.progress).toEqual({ phase: 'transcribing', startedAt: undefined });
  });

  it('drops events when there is no active job', () => {
    expect(applyBackgroundProgress(null, { kind: 'finalize-done' })).toBeNull();
  });

  it('ignores a trailing event after the job settled (done)', () => {
    const done: BackgroundJob = { kind: 'note', status: 'done', progress: { phase: 'persist', startedAt: START }, note: { family: 'lecture' } as never };
    expect(applyBackgroundProgress(done, { kind: 'finalize-done' })).toBe(done);
  });

  it('ignores a trailing event after the job settled (error)', () => {
    const errored: BackgroundJob = { kind: 'transcript', status: 'error', progress: null, message: 'STT_STALLED' };
    expect(applyBackgroundProgress(errored, { kind: 'transcribe-progress', pct: 99 })).toBe(errored);
  });
});
