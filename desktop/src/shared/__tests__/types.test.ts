import { describe, it, expect } from 'vitest';
import type { STTEngine, LLMEngine, TranscriptSegment } from '../engine-interfaces';
import { SUPPORTED_LANGUAGES } from '../types';

describe('shared types', () => {
  it('SUPPORTED_LANGUAGES 는 JA/EN/KO/ZH 4종만', () => {
    expect(SUPPORTED_LANGUAGES).toEqual(['ja', 'en', 'ko', 'zh']);
  });

  it('STTEngine.transcribe 는 Float32Array 를 받고 segments 배열을 돌려준다', () => {
    const e: STTEngine = {
      loadModel: async () => {},
      unloadModel: async () => {},
      transcribe: async () => ([] as TranscriptSegment[]),
      transcribeFile: async () => ([] as TranscriptSegment[]),
    };
    expect(typeof e.transcribe).toBe('function');
  });

  it('LLMEngine.generate 는 ChatMessage[] 를 받고 AsyncIterable<string> 을 돌려준다', async () => {
    const e: LLMEngine = {
      loadModel: async () => {},
      unloadModel: async () => {},
      generate: async function* () { yield 'a'; yield 'b'; },
    };
    const out: string[] = [];
    for await (const tok of e.generate([{ role: 'user', content: 'hi' }], {})) out.push(tok);
    expect(out).toEqual(['a', 'b']);
  });
});
