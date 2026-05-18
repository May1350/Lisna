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

describe('RecordingOrchestrator silence skip', () => {
  it('skips IPC for a silent chunk but advances wall-clock for the next real chunk', async () => {
    const sender = vi.fn<(p: ChunkPayload) => void>();
    const cap = new FakeCapturer();
    const orch = new RecordingOrchestrator({
      sender,
      capturerFactory: () => cap,
      firstChunkSec: 1,  // shorter for test speed
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

    // Sender called exactly ONCE (only the loud chunk reaches IPC)
    expect(sender).toHaveBeenCalledTimes(1);
    const sent = sender.mock.calls[0]![0];

    // Index stays contiguous: first sent chunk is index 0
    // (silent chunk did NOT advance chunkIndex)
    expect(sent.index).toBe(0);

    // But startMs reflects that 1s of silence elapsed before it
    // samplesEmitted advanced by 16000 from the silent chunk, so:
    //   startSamples = 16000 → startMs = 1000
    //   endSamples = 32000   → endMs   = 2000
    expect(sent.startMs).toBe(1000);
    expect(sent.endMs).toBe(2000);
  });

  it('does not send anything when all chunks are silent', async () => {
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
    expect(sender).not.toHaveBeenCalled();
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
