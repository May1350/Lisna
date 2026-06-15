import { describe, it, expect, vi, afterEach } from 'vitest';
import { SessionOrchestrator } from '../orchestrator';
import type { SessionPhase } from '@shared/ipc-protocol';
import { TIMEOUTS } from '../timeouts';

describe('SessionOrchestrator', () => {
  // Whisper transcribes each 10s chunk INDEPENDENTLY — segment timestamps are
  // chunk-relative ([0,10]). Without the session offset, a 12-min recording's
  // every segment claims to be in the first 10 seconds: live captions show
  // resetting timestamps, and the finalize prompt feeds the LLM a transcript
  // whose time anchors are all ~0, so the model fabricates section ts
  // (observed 2026-06-10: 12-min EN lecture → uniform fake 12s ladder).
  it('onChunk offsets chunk-relative segment ts to session time', async () => {
    const fakeStt = {
      loadModel: vi.fn(async () => {}),
      unloadModel: vi.fn(async () => {}),
      transcribe: vi.fn(async () => [
        { startSec: 0.5, endSec: 3.2, text: 'first' },
        { startSec: 4.0, endSec: 9.8, text: 'second' },
      ]),
    };
    const orch = new SessionOrchestrator({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stt: fakeStt as any, llm: {} as any,
      sttModelPath: '/stt', llmModelPath: '/llm', language: 'ja',
    });
    await orch.start();
    // Chunk at session offset 130s (e.g. the 14th 10s chunk).
    const segs = await orch.onChunk(new Float32Array(16000), 130);
    expect(segs.map((s) => s.startSec)).toEqual([130.5, 134.0]);
    expect(segs.map((s) => s.endSec)).toEqual([133.2, 139.8]);
    expect(orch.exposedSegments.map((s) => s.startSec)).toEqual([130.5, 134.0]);
  });

  it('onChunk without an offset keeps raw ts (back-compat default 0)', async () => {
    const fakeStt = {
      loadModel: vi.fn(async () => {}),
      unloadModel: vi.fn(async () => {}),
      transcribe: vi.fn(async () => [{ startSec: 1.0, endSec: 2.0, text: 'x' }]),
    };
    const orch = new SessionOrchestrator({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stt: fakeStt as any, llm: {} as any,
      sttModelPath: '/stt', llmModelPath: '/llm', language: 'ja',
    });
    await orch.start();
    const segs = await orch.onChunk(new Float32Array(16000));
    expect(segs[0]!.startSec).toBe(1.0);
  });

  it('start → 2 chunks → stop → load LLM → generate → unload 순서', async () => {
    const events: string[] = [];
    const fakeStt = {
      loadModel: vi.fn(async () => { events.push('stt-load'); }),
      unloadModel: vi.fn(async () => { events.push('stt-unload'); }),
      transcribe: vi.fn(async () => { events.push('stt-tx'); return [{ startSec: 0, endSec: 1, text: 'こんにちは' }]; }),
    };
    const fakeLlm = {
      loadModel: vi.fn(async () => { events.push('llm-load'); }),
      unloadModel: vi.fn(async () => { events.push('llm-unload'); }),
      generate: vi.fn(async function* () { events.push('llm-gen'); yield '#'; yield ' note'; }),
    };
    const orch = new SessionOrchestrator({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stt: fakeStt as any, llm: fakeLlm as any,
      sttModelPath: '/stt', llmModelPath: '/llm', language: 'ja',
    });
    await orch.start();
    await orch.onChunk(new Float32Array(16000));
    await orch.onChunk(new Float32Array(16000));
    const note = await orch.stop();
    expect(events).toEqual([
      'stt-load', 'stt-tx', 'stt-tx', 'stt-unload',
      'llm-load', 'llm-gen', 'llm-unload',
    ]);
    expect(note.markdown).toBe('# note');
    expect(note.language).toBe('ja');
    expect(note.transcriptSegments).toHaveLength(2);
    expect(new Date(note.generatedAt).toString()).not.toBe('Invalid Date');
  });

  it('still unloads LLM when generate throws mid-stream', async () => {
    const events: string[] = [];
    const fakeStt = {
      loadModel: vi.fn(async () => { events.push('stt-load'); }),
      unloadModel: vi.fn(async () => { events.push('stt-unload'); }),
      transcribe: vi.fn(async () => { events.push('stt-tx'); return [{ startSec: 0, endSec: 1, text: 'こんにちは' }]; }),
    };
    const fakeLlm = {
      loadModel: vi.fn(async () => { events.push('llm-load'); }),
      unloadModel: vi.fn(async () => { events.push('llm-unload'); }),
      generate: vi.fn(async function* () {
        events.push('llm-gen');
        yield '#';
        throw new Error('boom');
      }),
    };
    const orch = new SessionOrchestrator({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stt: fakeStt as any, llm: fakeLlm as any,
      sttModelPath: '/stt', llmModelPath: '/llm', language: 'ja',
    });
    await orch.start();
    // Need at least one non-empty segment so we don't trip the EMPTY_TRANSCRIPT guard.
    await orch.onChunk(new Float32Array(16000));
    await expect(orch.stop()).rejects.toThrow('boom');
    expect(events).toEqual(['stt-load', 'stt-tx', 'stt-unload', 'llm-load', 'llm-gen', 'llm-unload']);
  });

  it('fires onPhase callback in order during stop()', async () => {
    const phaseEvents: SessionPhase[] = [];
    const fakeStt = {
      loadModel: vi.fn(async () => {}),
      unloadModel: vi.fn(async () => {}),
      transcribe: vi.fn(async () => [{ startSec: 0, endSec: 1, text: 'こんにちは' }]),
    };
    const fakeLlm = {
      loadModel: vi.fn(async () => {}),
      unloadModel: vi.fn(async () => {}),
      generate: vi.fn(async function* () { yield '#'; yield ' note'; }),
    };
    const orch = new SessionOrchestrator({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stt: fakeStt as any, llm: fakeLlm as any,
      sttModelPath: '/stt', llmModelPath: '/llm', language: 'ja',
    });
    await orch.start();
    await orch.onChunk(new Float32Array(16000));
    await orch.stop((p) => phaseEvents.push(p));
    expect(phaseEvents).toEqual(['stt-unloading', 'llm-loading', 'generating']);
  });

  it('still fires earlier phases when stop() throws mid-generate', async () => {
    const phaseEvents: SessionPhase[] = [];
    const fakeStt = {
      loadModel: vi.fn(async () => {}),
      unloadModel: vi.fn(async () => {}),
      transcribe: vi.fn(async () => [{ startSec: 0, endSec: 1, text: 'こんにちは' }]),
    };
    const fakeLlm = {
      loadModel: vi.fn(async () => {}),
      unloadModel: vi.fn(async () => {}),
      generate: vi.fn(async function* () {
        yield 'partial';
        throw new Error('llm boom');
      }),
    };
    const orch = new SessionOrchestrator({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stt: fakeStt as any, llm: fakeLlm as any,
      sttModelPath: '/stt', llmModelPath: '/llm', language: 'ja',
    });
    await orch.start();
    await orch.onChunk(new Float32Array(16000));  // non-empty segments
    await expect(orch.stop((p) => phaseEvents.push(p))).rejects.toThrow('llm boom');
    expect(phaseEvents).toEqual(['stt-unloading', 'llm-loading', 'generating']);
    expect(fakeLlm.unloadModel).toHaveBeenCalled();
  });

  it('emits only stt-unloading when stt.unloadModel throws', async () => {
    const phaseEvents: SessionPhase[] = [];
    const fakeStt = {
      loadModel: vi.fn(async () => {}),
      unloadModel: vi.fn(async () => { throw new Error('stt boom'); }),
      transcribe: vi.fn(async () => []),
    };
    const fakeLlm = {
      loadModel: vi.fn(async () => {}),
      unloadModel: vi.fn(async () => {}),
      generate: vi.fn(),
    };
    const orch = new SessionOrchestrator({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stt: fakeStt as any, llm: fakeLlm as any,
      sttModelPath: '/stt', llmModelPath: '/llm', language: 'ja',
    });
    await orch.start();
    await expect(orch.stop((p) => phaseEvents.push(p))).rejects.toThrow('stt boom');
    expect(phaseEvents).toEqual(['stt-unloading']);
    expect(fakeLlm.loadModel).not.toHaveBeenCalled();
  });

  // --- Step 5 §3.5 operation-timeout integration ---
  //
  // Each phase's hanging-promise scenario throws the typed timeout code, so
  // ErrorView can map it. Note the test uses fake timers + the same constant
  // the production code reads so a future budget change in one place doesn't
  // silently de-sync the test.

  afterEach(() => {
    vi.useRealTimers();
  });

  // Helper: advance fake-timer clock while letting any microtasks (Promise.then
  // resolutions of the underlying op) interleave with timer firings. Without
  // this, a synchronous `vi.advanceTimersByTime` fires every queued timer
  // before any pending `Promise.resolve(promise).then(...)` microtask gets a
  // chance to clear it — so a fast-resolving op looks like it timed out.
  // `vi.runAllTimersAsync` is the idiomatic vitest equivalent.
  async function advanceAsync(ms: number) {
    // Advance in 100ms ticks so microtasks queued in response to each tick
    // can settle. `runAllTimersAsync` would run all timers + microtasks, but
    // tests below use partial advances to verify a specific phase fired.
    const tick = 100;
    let remaining = ms;
    while (remaining > 0) {
      const step = Math.min(tick, remaining);
      await vi.advanceTimersByTimeAsync(step);
      remaining -= step;
    }
  }

  it('start() rejects STT_TIMEOUT when stt.loadModel hangs past STT_LOAD_MS', async () => {
    vi.useFakeTimers();
    const fakeStt = {
      loadModel: vi.fn(() => new Promise<void>(() => {})),  // never resolves
      unloadModel: vi.fn(async () => {}),
      transcribe: vi.fn(),
    };
    const fakeLlm = {
      loadModel: vi.fn(),
      unloadModel: vi.fn(async () => {}),
      generate: vi.fn(),
    };
    const orch = new SessionOrchestrator({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stt: fakeStt as any, llm: fakeLlm as any,
      sttModelPath: '/stt', llmModelPath: '/llm', language: 'ja',
    });
    const startPromise = orch.start();
    // Pre-attach catch to avoid unhandledrejection during advanceTimers.
    const guarded = startPromise.catch((e) => e);
    await advanceAsync(TIMEOUTS.STT_LOAD_MS + 100);
    const err = await guarded;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('STT_TIMEOUT');
  });

  it('stop() rejects STT_TIMEOUT when stt.unloadModel hangs past STT_UNLOAD_MS', async () => {
    vi.useFakeTimers();
    const fakeStt = {
      loadModel: vi.fn(async () => {}),
      unloadModel: vi.fn(() => new Promise<void>(() => {})),  // hangs
      transcribe: vi.fn(async () => [{ startSec: 0, endSec: 1, text: 'こんにちは' }]),
    };
    const fakeLlm = {
      loadModel: vi.fn(),
      unloadModel: vi.fn(async () => {}),
      generate: vi.fn(),
    };
    const orch = new SessionOrchestrator({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stt: fakeStt as any, llm: fakeLlm as any,
      sttModelPath: '/stt', llmModelPath: '/llm', language: 'ja',
    });
    await orch.start();
    await orch.onChunk(new Float32Array(16000));  // non-empty segments
    const stopPromise = orch.stop();
    const guarded = stopPromise.catch((e) => e);
    await advanceAsync(TIMEOUTS.STT_UNLOAD_MS + 100);
    const err = await guarded;
    expect((err as Error).message).toBe('STT_TIMEOUT');
    // LLM must not have been touched (timeout aborted before llm.loadModel)
    expect(fakeLlm.loadModel).not.toHaveBeenCalled();
  });

  it('stop() rejects LLM_LOAD_TIMEOUT when llm.loadModel hangs past LLM_LOAD_MS', async () => {
    vi.useFakeTimers();
    const fakeStt = {
      loadModel: vi.fn(async () => {}),
      unloadModel: vi.fn(async () => {}),  // resolves fast
      transcribe: vi.fn(async () => [{ startSec: 0, endSec: 1, text: 'こんにちは' }]),
    };
    const fakeLlm = {
      loadModel: vi.fn(() => new Promise<void>(() => {})),  // hangs
      unloadModel: vi.fn(async () => {}),
      generate: vi.fn(),
    };
    const orch = new SessionOrchestrator({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stt: fakeStt as any, llm: fakeLlm as any,
      sttModelPath: '/stt', llmModelPath: '/llm', language: 'ja',
    });
    await orch.start();
    await orch.onChunk(new Float32Array(16000));
    const stopPromise = orch.stop();
    const guarded = stopPromise.catch((e) => e);
    await advanceAsync(TIMEOUTS.LLM_LOAD_MS + 100);
    const err = await guarded;
    expect((err as Error).message).toBe('LLM_LOAD_TIMEOUT');
  });

  it('stop() does not hang forever when llm.unloadModel hangs in finally (best-effort cap)', async () => {
    // The finally-unload is wrapped in `.catch(() => {})` so any rejection
    // (including the LLM_UNLOAD_TIMEOUT we now throw on hang) is silently
    // swallowed. The natural-success Note must still surface, even when
    // unload wedges — we cap the wait at LLM_UNLOAD_MS so the renderer
    // exits Finalizing in bounded time.
    vi.useFakeTimers();
    const fakeStt = {
      loadModel: vi.fn(async () => {}),
      unloadModel: vi.fn(async () => {}),
      transcribe: vi.fn(async () => [{ startSec: 0, endSec: 1, text: 'こんにちは' }]),
    };
    const fakeLlm = {
      loadModel: vi.fn(async () => {}),
      unloadModel: vi.fn(() => new Promise<void>(() => {})),  // hangs forever
      generate: vi.fn(async function* () { yield 'note'; }),
    };
    const orch = new SessionOrchestrator({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stt: fakeStt as any, llm: fakeLlm as any,
      sttModelPath: '/stt', llmModelPath: '/llm', language: 'ja',
    });
    await orch.start();
    await orch.onChunk(new Float32Array(16000));
    const stopPromise = orch.stop();
    await advanceAsync(TIMEOUTS.LLM_UNLOAD_MS + 100);
    const note = await stopPromise;
    expect(note.markdown).toBe('note');
  });

  it('fires onAudioChunk with the raw audio buffer before STT + timestamp remap', async () => {
    const seen: { len: number; offset: number }[] = [];
    const order: string[] = [];
    const fakeStt = {
      loadModel: vi.fn(async () => {}),
      unloadModel: vi.fn(async () => {}),
      transcribe: vi.fn(async () => {
        order.push('transcribe');
        return [{ startSec: 0.5, endSec: 3.2, text: 'first' }];
      }),
    };
    const orch = new SessionOrchestrator({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stt: fakeStt as any, llm: {} as any,
      sttModelPath: '/stt', llmModelPath: '/llm', language: 'ja',
      onAudioChunk: (audio, offsetSec) => {
        order.push('audio');
        seen.push({ len: audio.length, offset: offsetSec });
      },
    });
    await orch.start();
    await orch.onChunk(new Float32Array(16000), 130);
    expect(seen).toEqual([{ len: 16000, offset: 130 }]);
    // The hook must observe the RAW buffer before STT/remap → it fires first.
    expect(order).toEqual(['audio', 'transcribe']);
  });

  // STT Phase 1: the session-level proper-noun glossary is forwarded to every
  // chunk's transcribe call as initialPrompt. Default (unset) → undefined.
  it('threads sttInitialPrompt to stt.transcribe (and undefined when unset)', async () => {
    const fakeStt = {
      loadModel: vi.fn(async () => {}),
      unloadModel: vi.fn(async () => {}),
      transcribe: vi.fn(async () => [{ startSec: 0, endSec: 1, text: 'x' }]),
    };
    const orch = new SessionOrchestrator({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stt: fakeStt as any, llm: {} as any,
      sttModelPath: '/stt', llmModelPath: '/llm', language: 'ja',
      sttInitialPrompt: '明治ホールディングス',
    });
    await orch.start();
    await orch.onChunk(new Float32Array(16000));
    expect(fakeStt.transcribe).toHaveBeenCalledWith(
      expect.any(Float32Array),
      { initialPrompt: '明治ホールディングス' },
    );

    const fakeStt2 = {
      loadModel: vi.fn(async () => {}),
      unloadModel: vi.fn(async () => {}),
      transcribe: vi.fn(async () => [{ startSec: 0, endSec: 1, text: 'x' }]),
    };
    const orch2 = new SessionOrchestrator({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stt: fakeStt2 as any, llm: {} as any,
      sttModelPath: '/stt', llmModelPath: '/llm', language: 'ja',
    });
    await orch2.start();
    await orch2.onChunk(new Float32Array(16000));
    expect(fakeStt2.transcribe).toHaveBeenCalledWith(
      expect.any(Float32Array),
      { initialPrompt: undefined },
    );
  });

  // M1: empty-transcript guard. If no segments were captured (silence-only
  // recording, or user clicked Start/Stop without speaking), stop() unloads STT
  // but throws EMPTY_TRANSCRIPT before loading the LLM. Renderer maps this
  // error to a friendlier ErrorView copy. Prevents 10-30s wait for the LLM to
  // hallucinate a fake note from an empty prompt.
  it('throws EMPTY_TRANSCRIPT when segments is empty (skips LLM round-trip)', async () => {
    const phaseEvents: SessionPhase[] = [];
    const fakeStt = {
      loadModel: vi.fn(async () => {}),
      unloadModel: vi.fn(async () => {}),
      transcribe: vi.fn(),
    };
    const fakeLlm = {
      loadModel: vi.fn(async () => {}),
      unloadModel: vi.fn(async () => {}),
      generate: vi.fn(),
    };
    const orch = new SessionOrchestrator({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stt: fakeStt as any, llm: fakeLlm as any,
      sttModelPath: '/stt', llmModelPath: '/llm', language: 'ja',
    });
    await orch.start();
    // No onChunk calls → segments stays empty.
    await expect(orch.stop((p) => phaseEvents.push(p))).rejects.toThrow('EMPTY_TRANSCRIPT');
    expect(phaseEvents).toEqual(['stt-unloading']);
    expect(fakeStt.unloadModel).toHaveBeenCalled();
    expect(fakeLlm.loadModel).not.toHaveBeenCalled();
    expect(fakeLlm.generate).not.toHaveBeenCalled();
  });
});
