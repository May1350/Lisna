// desktop/src/main/sidecar/__tests__/meeting-extract.test.ts
import { describe, it, expect } from 'vitest';
import { extractMeetingAtoms } from '../meeting-extract';
import type { LlmGenerator } from '../grammar-call';

const atomsJson = JSON.stringify({
  decisions: [{ text: 'プロプランを3,480円に値上げ', ts: 10 }],
  action_items: [], key_figures: [{ label: 'MRR', value: '4,200万円', ts: 5 }],
  open_questions: [], risks: [],
});
const mockGen = (): LlmGenerator => async (o) => ({ text: atomsJson, seed: o.seed, stats: { tokensOut: 50, genMs: 10 } });

describe('extractMeetingAtoms', () => {
  it('parses flat atoms from one chunk and reports the chunk ts-range', async () => {
    const r = await extractMeetingAtoms({
      chunk: { sessionId: 's', speakers: [{ id: 0 }], transcriptSegments: [{ ts: 0, endTs: 12, text: 'プロプランの料金を上げます', speakerId: 0 }] },
      generator: mockGen(), language: 'ja', chunkIndex: 0, totalChunks: 1, speakers: [{ id: 0 }],
    });
    expect(r.ok).toBe(true);
    expect(r.atoms.decisions).toHaveLength(1);
    expect(r.tsRange).toEqual([0, 12]);
  });

  it('returns ok:false with empty atoms when the model output is unparseable', async () => {
    const bad: LlmGenerator = async (o) => ({ text: 'not json', seed: o.seed });
    const r = await extractMeetingAtoms({
      chunk: { sessionId: 's', speakers: [{ id: 0 }], transcriptSegments: [{ ts: 0, endTs: 5, text: 'x', speakerId: 0 }] },
      generator: bad, language: 'ja', chunkIndex: 0, totalChunks: 1, speakers: [{ id: 0 }],
    });
    expect(r.ok).toBe(false);
    expect(r.atoms.decisions).toEqual([]);
  });
});
