import { describe, it, expect } from 'vitest';
import { NoOpDiarization } from '../noop-diarization';
import type { TranscriptSegment } from '@shared/note-schema/transcript';

describe('NoOpDiarization', () => {
  it('loadModel / unloadModel resolve immediately', async () => {
    const d = new NoOpDiarization();
    await expect(d.loadModel()).resolves.toBeUndefined();
    await expect(d.unloadModel()).resolves.toBeUndefined();
  });

  it('processChunk forces speakerId=0 on every segment, never tentative', async () => {
    const d = new NoOpDiarization();
    const segs: TranscriptSegment[] = [
      { ts: 0, endTs: 1, text: 'hi', speakerId: 3 },
      { ts: 1, endTs: 2, text: 'there', speakerId: 5 },
    ];
    const out = await d.processChunk(new Float32Array(16_000), segs);
    expect(out).toEqual([
      { ts: 0, endTs: 1, text: 'hi', speakerId: 0 },
      { ts: 1, endTs: 2, text: 'there', speakerId: 0 },
    ]);
    for (const s of out) expect(s.tentative).toBeUndefined();
  });

  it('preserves the meta passthrough hatch', async () => {
    const d = new NoOpDiarization();
    const segs: TranscriptSegment[] = [
      { ts: 0, endTs: 1, text: 'hi', speakerId: 0, meta: { noSpeechProb: 0.1 } },
    ];
    const out = await d.processChunk(new Float32Array(16_000), segs);
    expect(out[0]?.meta).toEqual({ noSpeechProb: 0.1 });
  });

  it('processChunk on empty input returns []', async () => {
    const d = new NoOpDiarization();
    const out = await d.processChunk(new Float32Array(0), []);
    expect(out).toEqual([]);
  });
});
