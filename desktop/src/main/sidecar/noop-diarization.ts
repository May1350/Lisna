import type { DiarizationEngine } from '@shared/diarization';
import type { SpeakerLabeledSegment } from '@shared/pipeline-hooks';
import type { TranscriptSegment } from '@shared/note-schema/transcript';

/**
 * No-op DiarizationEngine for the Lecture family + the final fallback rung
 * (when sherpa-onnx is unavailable or every embedding model fails DER
 * acceptance — spec section 7.1).
 *
 * Forces every segment to speakerId 0 (single-speaker labels) regardless of any
 * speakerId the upstream STT→v2 adapter may have set. SessionTranscript then
 * carries `speakers: [{ id: 0 }]` and the renderer omits speaker chips. No
 * tentative flag — labels are immediately final.
 *
 * Per spec section 2.4: "Lecture family uses NoOpDiarization for RAM/battery
 * savings"; per section 7.1 it is also the terminal fallback.
 */
export class NoOpDiarization implements DiarizationEngine {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- NoOp ignores the model paths the interface requires
  async loadModel(_segmentationPath: string, _embeddingPath: string): Promise<void> {
    // intentional no-op
  }

  async unloadModel(): Promise<void> {
    // intentional no-op
  }

  async processChunk(
    _audio: Float32Array,
    sttSegments: TranscriptSegment[],
  ): Promise<SpeakerLabeledSegment[]> {
    return sttSegments.map((s) => ({ ...s, speakerId: 0 }));
  }
}
