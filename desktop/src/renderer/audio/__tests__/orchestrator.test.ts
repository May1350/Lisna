import { describe, it, expect, vi } from 'vitest';
import { RecordingOrchestrator, type ChunkPayload, type Capturer } from '../orchestrator';

const SR = 16000;

/**
 * Make a non-silent Float32Array of the given length (filled with 0.5). Most
 * chunking / timestamp / index tests use this for a realistic audible signal.
 * Since STT Phase 2 removed the isSilent gate, all-zero arrays are also sent to
 * IPC now (gap-faithful WAV), so either works for those — see the dedicated
 * 'emits silent chunks too' case below.
 */
function loudChunk(length: number): Float32Array {
  const a = new Float32Array(length);
  a.fill(0.5);
  return a;
}

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
    for (let i = 0; i < 25; i++) fake.onSamples!(loudChunk(1600));
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
    for (let i = 0; i < 25; i++) fake.onSamples!(loudChunk(1600));
    await orch.stop();

    expect(fake.stop).toHaveBeenCalled();
  });

  it('chunk timestamps: first [0, 2000), second [2000, 12000)', async () => {
    const fake = makeFakeCapturer();
    const sender = vi.fn();
    const orch = new RecordingOrchestrator({
      sender,
      capturerFactory: () => fake as unknown as Capturer,
    });

    await orch.start('mic');
    // Use a tick size (12100 samples) that does NOT divide the 2s (32000) or
    // 12s (192000) chunk boundary. The 3rd tick (cumulative 36300) crosses
    // the first boundary mid-push, and the 16th tick (cumulative 193600)
    // crosses the second boundary mid-push. Any emit-time clock reading
    // post-push sample counts will overshoot. Pinning the chunk's true
    // boundary catches that.
    for (let i = 0; i < 16; i++) fake.onSamples!(loudChunk(12100));
    await orch.stop();

    const c0 = sender.mock.calls[0]![0] as ChunkPayload;
    const c1 = sender.mock.calls[1]![0] as ChunkPayload;
    expect(c0.startMs).toBe(0);
    expect(c0.endMs).toBe(2000);
    expect(c1.startMs).toBe(2000);
    expect(c1.endMs).toBe(12000);
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
    for (let i = 0; i < 120; i++) fake.onSamples!(loudChunk(1600));
    await orch.stop();

    expect(sender).toHaveBeenCalledTimes(2);
    const c0 = sender.mock.calls[0]![0] as ChunkPayload;
    const c1 = sender.mock.calls[1]![0] as ChunkPayload;
    expect(c0.index).toBe(0);
    expect(c1.index).toBe(1);
    expect(c0.samples.length).toBe(SR * 2);
    expect(c1.samples.length).toBe(SR * 10);
  });

  it('start() is idempotent — second call on same instance does not double-init', async () => {
    // Regression guard for the `if (this.capturer) return;` protection inside
    // RecordingOrchestrator.start(). Recording.tsx layer protects against
    // two orchestrator *instances* via startingRef; this test pins the
    // per-instance protection so a future refactor can't quietly drop it.
    const fake = makeFakeCapturer();
    const sender = vi.fn();
    const startSpy = vi.spyOn(fake, 'start');
    const orch = new RecordingOrchestrator({
      sender,
      capturerFactory: () => fake as unknown as Capturer,
    });

    await orch.start('mic');
    await orch.start('mic'); // second call must early-return
    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  it('emits silent chunks too (WAV must be gap-faithful)', async () => {
    // STT Phase 2: live per-chunk STT is gone; the whole-file WAV is
    // transcribed at finalize. Silent gaps must be preserved so absolute
    // timestamps + duration are correct. The old isSilent gate must not drop
    // any chunks.
    const fake = makeFakeCapturer();
    const sent: number[] = [];
    const orch = new RecordingOrchestrator({
      sender: (c) => sent.push(c.samples.length),
      capturerFactory: () => fake as unknown as Capturer,
      firstChunkSec: 1, // 1s first chunk for test speed
      chunkSec: 1,
    });

    await orch.start('mic');
    // Push exactly 1s of all-zero samples → fills the first chunk boundary.
    // Previously, isSilent() would drop this, leaving sent empty.
    fake.onSamples!(new Float32Array(SR)); // all-zero = silent
    await orch.stop();

    expect(sent).toEqual([SR]);
  });
});
