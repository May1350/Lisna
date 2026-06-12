/**
 * FinalizeTelemetryEvent → FinalizeProgressPayload (renderer progress feed,
 * founder ask 2026-06-13). Pure so it stays testable without an electron
 * mock; ipc.ts's onTelemetry calls it and safeSends non-null results over
 * CHANNELS.sessionFinalizeProgress.
 *
 * PII contract: the renderer payload carries ONLY the fields the progress UI
 * renders. In particular the completed-attempt `reason` never crosses —
 * it can embed note-content samples (ESCAPE_LITERAL_AT_<path>:"<sample>").
 */
import type { FinalizeTelemetryEvent } from '../orchestrator';
import type { FinalizeProgressPayload } from '@shared/ipc-protocol';

export function toFinalizeProgressPayload(
  e: FinalizeTelemetryEvent,
): FinalizeProgressPayload | null {
  switch (e.kind) {
    case 'attempt-start':
      return {
        kind: 'attempt-start',
        chunkIndex: e.chunkIndex,
        totalChunks: e.totalChunks,
        attempt: e.attempt,
        maxAttempts: e.maxAttempts,
      };
    case 'chunk-done':
      return { kind: 'chunk-done', chunkIndex: e.chunkIndex, totalChunks: e.totalChunks };
    case 'finalize-done':
      return { kind: 'finalize-done' };
    case 'attempt':
      // Log-only: the renderer's live state comes from attempt-start, and
      // this variant's `reason` may carry content samples.
      return null;
    default: {
      const _exhaustive: never = e;
      return _exhaustive;
    }
  }
}
