import { describe, it, expect } from 'vitest';
import type { DiarizationEngine } from '../diarization';
import type { SpeakerLabeledSegment } from '../pipeline-hooks';
import type { TranscriptSegment } from '../note-schema/transcript';

describe('DiarizationEngine interface', () => {
  it('exposes loadModel / unloadModel / processChunk', async () => {
    const stub: DiarizationEngine = {
      async loadModel(_seg: string, _emb: string) {},
      async unloadModel() {},
      async processChunk(_audio: Float32Array, segs: TranscriptSegment[]) {
        return segs.map((s) => ({ ...s, tentative: false }));
      },
    };
    await expect(stub.loadModel('seg.onnx', 'emb.onnx')).resolves.toBeUndefined();
    await expect(stub.unloadModel()).resolves.toBeUndefined();
  });

  it('processChunk consumes v2 TranscriptSegment[] and returns SpeakerLabeledSegment[]', async () => {
    const stub: DiarizationEngine = {
      async loadModel() {},
      async unloadModel() {},
      async processChunk(_audio, segs) {
        return segs.map((s) => ({ ...s, speakerId: 1, tentative: true }));
      },
    };
    const input: TranscriptSegment[] = [
      { ts: 0, endTs: 1, text: 'hello', speakerId: 0 },
    ];
    const out: SpeakerLabeledSegment[] = await stub.processChunk(new Float32Array(16_000), input);
    expect(out).toHaveLength(1);
    const [first] = out;
    expect(first?.speakerId).toBe(1);
    expect(first?.tentative).toBe(true);
    expect(first?.endTs).toBe(1);
  });
});
