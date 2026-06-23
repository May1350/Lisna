import { describe, it, expect, vi } from 'vitest';
import { RecordingOrchestrator } from '../orchestrator';
import type { ChunkPayload, RecordingSource } from '@shared/ipc-protocol';
import type { Capturer } from '../orchestrator';
import { SAMPLE_RATE } from '../chunker';

class FakeCapturer implements Capturer {
  private cb: ((s: Float32Array) => void) | null = null;
  async start(onSamples: (s: Float32Array) => void) {
    this.cb = onSamples;
    return { sampleRate: SAMPLE_RATE };
  }
  async stop() {
    this.cb = null;
  }
  push(s: Float32Array) {
    this.cb?.(s);
  }
}

// STT Phase 2: the isSilent gate was removed from emitChunk. Silent chunks are
// now streamed to preserve gap-faithful WAV timestamps. These tests reflect the
// updated behavior: every chunk (silent or not) is sent to IPC, with contiguous
// indices and correct timestamps that account for all elapsed samples.
describe('RecordingOrchestrator silence passthrough (STT Phase 2)', () => {
  it('sends a silent chunk to IPC and advances both samplesEmitted and chunkIndex', async () => {
    const sender = vi.fn<(p: ChunkPayload) => void>();
    const cap = new FakeCapturer();
    const orch = new RecordingOrchestrator({
      sender,
      capturerFactory: () => cap,
      firstChunkSec: 1,
      chunkSec: 1,
    });
    await orch.start('mic' as RecordingSource);

    // Push 1s of pure silence → first chunk (1s = 16000 samples) is silent
    cap.push(new Float32Array(SAMPLE_RATE));
    // Push 1s of loud signal → second chunk (1s) is NOT silent
    const loud = new Float32Array(SAMPLE_RATE);
    loud.fill(0.5);
    cap.push(loud);

    await orch.stop();

    // Sender called TWICE: both the silent and loud chunks reach IPC
    expect(sender).toHaveBeenCalledTimes(2);

    const silent = sender.mock.calls[0]![0];
    const loudChunk = sender.mock.calls[1]![0];

    // Silent chunk: index 0, timestamps [0, 1000)
    expect(silent.index).toBe(0);
    expect(silent.startMs).toBe(0);
    expect(silent.endMs).toBe(1000);

    // Loud chunk: index 1, timestamps [1000, 2000)
    expect(loudChunk.index).toBe(1);
    expect(loudChunk.startMs).toBe(1000);
    expect(loudChunk.endMs).toBe(2000);
  });

  it('sends all chunks when all are silent', async () => {
    const sender = vi.fn<(p: ChunkPayload) => void>();
    const cap = new FakeCapturer();
    const orch = new RecordingOrchestrator({
      sender,
      capturerFactory: () => cap,
      firstChunkSec: 1,
      chunkSec: 1,
    });
    await orch.start('mic' as RecordingSource);
    cap.push(new Float32Array(SAMPLE_RATE));
    cap.push(new Float32Array(SAMPLE_RATE));
    cap.push(new Float32Array(SAMPLE_RATE));
    await orch.stop();
    expect(sender).toHaveBeenCalledTimes(3);
    expect(sender.mock.calls[0]![0].index).toBe(0);
    expect(sender.mock.calls[1]![0].index).toBe(1);
    expect(sender.mock.calls[2]![0].index).toBe(2);
  });

  it('sends consecutive real chunks with contiguous indices', async () => {
    const sender = vi.fn<(p: ChunkPayload) => void>();
    const cap = new FakeCapturer();
    const orch = new RecordingOrchestrator({
      sender,
      capturerFactory: () => cap,
      firstChunkSec: 1,
      chunkSec: 1,
    });
    await orch.start('mic' as RecordingSource);
    const loud = new Float32Array(SAMPLE_RATE);
    loud.fill(0.3);
    cap.push(loud);
    cap.push(loud);
    cap.push(loud);
    await orch.stop();
    expect(sender).toHaveBeenCalledTimes(3);
    expect(sender.mock.calls[0]![0].index).toBe(0);
    expect(sender.mock.calls[1]![0].index).toBe(1);
    expect(sender.mock.calls[2]![0].index).toBe(2);
  });
});
