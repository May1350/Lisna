import { describe, it, expect, vi } from 'vitest';
import { SessionOrchestrator } from '../orchestrator';
import type { TranscriptSegment } from '@shared/engine-interfaces';

// STT Phase 2 — record-then-transcribe. The orchestrator no longer runs STT
// during recording: `start()` only resets state (no model I/O), `onChunk()`
// fires the `onAudioChunk` WAV side-channel and returns `[]` (it does NOT call
// `stt.transcribe`), and the transcript is supplied at finalize via
// `setFinalizeSegments()`. The legacy live `stop()` markdown path was deleted
// (the v2 family pipeline owns finalize). These tests pin the new contract.
describe('SessionOrchestrator', () => {
  it('onChunk fires onAudioChunk (raw buffer + offset), does NOT transcribe, returns []', async () => {
    const seen: { len: number; offset: number }[] = [];
    const fakeStt = {
      loadModel: vi.fn(async () => {}),
      unloadModel: vi.fn(async () => {}),
      transcribe: vi.fn(async () => [{ startSec: 0, endSec: 1, text: 'x' }]),
    };
    const orch = new SessionOrchestrator({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stt: fakeStt as any, llm: {} as any,
      sttModelPath: '/stt', llmModelPath: '/llm', language: 'ja',
      onAudioChunk: (audio, offsetSec) => {
        seen.push({ len: audio.length, offset: offsetSec });
      },
    });
    await orch.start();
    const segs = await orch.onChunk(new Float32Array(16000), 130);
    expect(segs).toEqual([]);
    expect(seen).toEqual([{ len: 16000, offset: 130 }]);
    // Live STT was removed — the chunk loop must never touch the STT engine.
    expect(fakeStt.transcribe).not.toHaveBeenCalled();
    // exposedSegments stays empty during recording (set only at finalize).
    expect(orch.exposedSegments).toEqual([]);
  });

  it('onChunk defaults sessionOffsetSec to 0 and still returns []', async () => {
    const seen: { len: number; offset: number }[] = [];
    const fakeStt = {
      loadModel: vi.fn(async () => {}),
      unloadModel: vi.fn(async () => {}),
      transcribe: vi.fn(),
    };
    const orch = new SessionOrchestrator({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stt: fakeStt as any, llm: {} as any,
      sttModelPath: '/stt', llmModelPath: '/llm', language: 'ja',
      onAudioChunk: (audio, offsetSec) => {
        seen.push({ len: audio.length, offset: offsetSec });
      },
    });
    await orch.start();
    const segs = await orch.onChunk(new Float32Array(16000));
    expect(segs).toEqual([]);
    expect(seen).toEqual([{ len: 16000, offset: 0 }]);
    expect(fakeStt.transcribe).not.toHaveBeenCalled();
  });

  it('onChunk is a no-op (returns []) when onAudioChunk is unset', async () => {
    const orch = new SessionOrchestrator({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stt: {} as any, llm: {} as any,
      sttModelPath: '/stt', llmModelPath: '/llm', language: 'ja',
    });
    await orch.start();
    await expect(orch.onChunk(new Float32Array(16000), 42)).resolves.toEqual([]);
  });

  it('exposedSegments reflects setFinalizeSegments (set once at finalize)', async () => {
    const orch = new SessionOrchestrator({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stt: {} as any, llm: {} as any,
      sttModelPath: '/stt', llmModelPath: '/llm', language: 'ja',
    });
    // Fresh orchestrator exposes no segments.
    expect(orch.exposedSegments).toEqual([]);
    const segs: TranscriptSegment[] = [{ startSec: 1, endSec: 2, text: 'hello' }];
    orch.setFinalizeSegments(segs);
    expect(orch.exposedSegments).toEqual(segs);
  });

  it('start() does NOT load STT and resets finalizeSegments to empty', async () => {
    const fakeStt = {
      loadModel: vi.fn(async () => {}),
      unloadModel: vi.fn(async () => {}),
      transcribe: vi.fn(),
    };
    const orch = new SessionOrchestrator({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stt: fakeStt as any, llm: {} as any,
      sttModelPath: '/stt', llmModelPath: '/llm', language: 'ja',
    });
    // Seed segments, then start() must clear them — a re-used instance must not
    // leak a prior finalize's transcript.
    orch.setFinalizeSegments([{ startSec: 0, endSec: 1, text: 'stale' }]);
    await orch.start();
    expect(orch.exposedSegments).toEqual([]);
    // No model I/O during recording (STT Phase 2).
    expect(fakeStt.loadModel).not.toHaveBeenCalled();
  });

  it('language getter returns the language passed at construction', () => {
    const orch = new SessionOrchestrator({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stt: {} as any, llm: {} as any,
      sttModelPath: '/stt', llmModelPath: '/llm', language: 'ja',
    });
    expect(orch.language).toBe('ja');
  });

  it('wavPath getter returns opts.wavPath, or null when unset', () => {
    const withPath = new SessionOrchestrator({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stt: {} as any, llm: {} as any,
      sttModelPath: '/stt', llmModelPath: '/llm', language: 'ja',
      wavPath: '/tmp/session.wav',
    });
    expect(withPath.wavPath).toBe('/tmp/session.wav');

    const noPath = new SessionOrchestrator({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stt: {} as any, llm: {} as any,
      sttModelPath: '/stt', llmModelPath: '/llm', language: 'ja',
    });
    expect(noPath.wavPath).toBeNull();
  });
});
