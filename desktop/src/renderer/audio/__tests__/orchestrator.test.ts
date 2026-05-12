import { describe, it, expect, vi } from 'vitest';
import { RecordingOrchestrator, type ChunkPayload, type Capturer } from '../orchestrator';

const SR = 16000;

/**
 * Fake capturer that captures the onSamples callback in start() so tests can
 * drive samples directly, without reaching into the orchestrator's private
 * fields. Shape matches the real Capturer interface.
 */
function makeFakeCapturer() {
  const fake = {
    onSamples: null as ((s: Float32Array) => void) | null,
    async start(cb: (s: Float32Array) => void) {
      fake.onSamples = cb;
      return { sampleRate: SR };
    },
    stop: vi.fn().mockResolvedValue(undefined),
  };
  return fake;
}

describe('RecordingOrchestrator', () => {
  it('emits first chunk (2s = 32000 samples) at index=0 after 25 ticks of 1600 samples', async () => {
    const fake = makeFakeCapturer();
    const sender = vi.fn();
    const orch = new RecordingOrchestrator({
      sender,
      capturerFactory: () => fake as unknown as Capturer,
    });

    await orch.start('mic');
    // 25 ticks × 1600 samples = 40000 samples (2.5s) → enough for the 2s first chunk
    for (let i = 0; i < 25; i++) fake.onSamples!(new Float32Array(1600));
    await orch.stop();

    expect(sender).toHaveBeenCalled();
    const firstCall = sender.mock.calls[0]![0] as ChunkPayload;
    expect(firstCall.index).toBe(0);
    expect(firstCall.samples.length).toBe(SR * 2);
  });

  it('stops capturer on stop()', async () => {
    const fake = makeFakeCapturer();
    const sender = vi.fn();
    const orch = new RecordingOrchestrator({
      sender,
      capturerFactory: () => fake as unknown as Capturer,
    });

    await orch.start('mic');
    for (let i = 0; i < 25; i++) fake.onSamples!(new Float32Array(1600));
    await orch.stop();

    expect(fake.stop).toHaveBeenCalled();
  });

  it('indices increase monotonically: 12s of audio → index=0 then index=1', async () => {
    const fake = makeFakeCapturer();
    const sender = vi.fn();
    const orch = new RecordingOrchestrator({
      sender,
      capturerFactory: () => fake as unknown as Capturer,
    });

    await orch.start('mic');
    // 2s first chunk + 10s second chunk = 12s = 192000 samples → 120 ticks of 1600
    for (let i = 0; i < 120; i++) fake.onSamples!(new Float32Array(1600));
    await orch.stop();

    expect(sender).toHaveBeenCalledTimes(2);
    const c0 = sender.mock.calls[0]![0] as ChunkPayload;
    const c1 = sender.mock.calls[1]![0] as ChunkPayload;
    expect(c0.index).toBe(0);
    expect(c1.index).toBe(1);
    expect(c0.samples.length).toBe(SR * 2);
    expect(c1.samples.length).toBe(SR * 10);
  });
});
