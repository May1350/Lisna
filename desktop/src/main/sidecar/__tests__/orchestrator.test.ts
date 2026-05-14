import { describe, it, expect, vi } from 'vitest';
import { SessionOrchestrator } from '../orchestrator';
import type { SessionPhase } from '@shared/ipc-protocol';

describe('SessionOrchestrator', () => {
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
