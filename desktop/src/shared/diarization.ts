import type { TranscriptSegment } from './note-schema/transcript';
import type { SpeakerLabeledSegment } from './pipeline-hooks';

/**
 * The diarization engine. Mirrors STTEngine / LLMEngine lifecycle: load → use →
 * unload (see engine-interfaces.ts). Per spec section 2.4, runs always-parallel
 * during recording regardless of which family the user picks at Stop. The TS
 * adapter calls into the C++ sidecar over IPC; segmentation + embedding model
 * paths are resolved at boot by model-resolver.
 *
 * Lives here rather than engine-interfaces.ts because that file is pinned to the
 * legacy `types.ts::TranscriptSegment` (startSec/endSec, no speakerId) that the
 * STT path emits. Diarization operates on the v2 structured-note
 * `note-schema/transcript.ts::TranscriptSegment` (ts/endTs/speakerId/meta) —
 * the orchestrator has already adapted legacy→v2 by the time the diarize stage
 * runs (see pipeline-hooks.ts ordering: afterTranscribe → beforeDiarize →
 * afterDiarize). `SpeakerLabeledSegment` is the post-diarization v2 shape,
 * defined once in pipeline-hooks.ts.
 */
export interface DiarizationEngine {
  /**
   * Load segmentation + embedding ONNX models into the sidecar. Resolves after
   * both are mmap'd and a warm-up forward-pass has run on a tiny frame, so the
   * first processChunk doesn't pay Metal cold-cache cost (see
   * project_metal_cold_cache_first_run).
   */
  loadModel(segmentationPath: string, embeddingPath: string): Promise<void>;

  /**
   * OS-confirmed RSS reclamation (same contract as STTEngine.unloadModel —
   * mach_vm + madvise). Resolves AFTER the sidecar reports the RSS drop. Per
   * spec section 5.1 the diarization model unloads at session/finalize alongside
   * STT, before the LLM loads.
   */
  unloadModel(): Promise<void>;

  /**
   * Process one ~10s audio chunk plus the v2 STT segments derived from the same
   * chunk, returning the segments with `speakerId` assigned via online
   * clustering. Caller is responsible for ordering / coalescing across chunk
   * boundaries.
   *
   * Latency budget: < 1s per 10s chunk on M1 8GB (spec section 7.1 G3). Throws on
   * sidecar timeout (DIARIZE_TIMEOUT, mirrors STT_TIMEOUT).
   */
  processChunk(
    audio: Float32Array,
    sttSegments: TranscriptSegment[],
  ): Promise<SpeakerLabeledSegment[]>;
}
