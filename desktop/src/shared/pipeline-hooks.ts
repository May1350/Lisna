import type { TranscriptSegment, SessionTranscript } from '@shared/note-schema/transcript';
import type { NoteBase } from '@shared/note-schema/base';

/**
 * Live captured speaker-labeled segment (post-diarization).
 * Spec section 4.0 — duplicated here to avoid a circular import from
 * note-schema. Plan 4 will canonicalise via Diarization module.
 */
export interface SpeakerLabeledSegment extends TranscriptSegment {
  /** True during diarization warm-up window (~10-30s). */
  tentative?: boolean;
}

/**
 * Per spec section 4.0 and section 4 item 14. Each hook is optional — default is identity
 * passthrough. Hooks may be sync or async. Errors are caught by the
 * orchestrator and appended to NoteBase.validation_warnings; pipeline
 * continues with the pre-hook value.
 *
 * Order of execution in Plan 3's orchestrator:
 *   afterTranscribe -> beforeDiarize -> afterDiarize -> beforeChunk
 *     -> afterLLM (per chunk) -> afterValidate -> afterMerge
 */
export interface PipelineHooks {
  afterTranscribe?: (segs: TranscriptSegment[]) =>
    TranscriptSegment[] | Promise<TranscriptSegment[]>;
  beforeDiarize?: (segs: TranscriptSegment[]) => TranscriptSegment[];
  afterDiarize?: (segs: SpeakerLabeledSegment[]) => SpeakerLabeledSegment[];
  beforeChunk?: (transcript: SessionTranscript) => SessionTranscript;
  afterLLM?: (parsedJson: unknown, chunkIndex: number) => unknown;
  afterValidate?: (note: NoteBase) => NoteBase;
  afterMerge?: (note: NoteBase) => NoteBase;
}
