import { describe, it, expect, vi } from 'vitest';
import { SessionOrchestrator } from '../orchestrator';

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
  });
});
