import { describe, it, expect } from 'vitest';
import type { STTEngine, TranscriptSegment } from '@shared/engine-interfaces';
import { makeRealSttFn } from './real-stt-fn';

function makeStub(segments: TranscriptSegment[], onTranscribe?: (audio: Float32Array) => void): STTEngine {
  return {
    loadModel: async () => {},
    unloadModel: async () => {},
    transcribe: async (audio) => { onTranscribe?.(audio); return segments; },
  };
}

const seg = (text: string, startSec = 0, endSec = 1): TranscriptSegment => ({ startSec, endSec, text });

describe('makeRealSttFn', () => {
  it('joins multiple segments into a single string in order', async () => {
    const stub = makeStub([seg('今日は'), seg('良い天気です'), seg('ね')]);
    const fn = makeRealSttFn(stub);
    expect(await fn(new Float32Array(1), 16000, 'clean')).toBe('今日は良い天気ですね');
  });

  it('returns empty string for zero segments', async () => {
    const fn = makeRealSttFn(makeStub([]));
    expect(await fn(new Float32Array(1), 16000, 'clean')).toBe('');
  });

  it('forwards the pcm array unchanged to the engine (no copy / no truncation)', async () => {
    let seenLen = -1;
    const stub = makeStub([seg('ok')], (a) => { seenLen = a.length; });
    const fn = makeRealSttFn(stub);
    await fn(new Float32Array(256), 16000, 'far-field-synth');
    expect(seenLen).toBe(256);
  });

  it('SttCondition arg is opaque to the engine (it sees only audio)', async () => {
    // The engine should be called exactly once regardless of condition;
    // condition affects only the orchestrator's input selection, not the call shape.
    let calls = 0;
    const stub: STTEngine = {
      loadModel: async () => {},
      unloadModel: async () => {},
      transcribe: async () => { calls++; return [seg('x')]; },
    };
    const fn = makeRealSttFn(stub);
    await fn(new Float32Array(1), 16000, 'far-field-real');
    expect(calls).toBe(1);
  });
});
