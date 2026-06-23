import { describe, it, expect } from 'vitest';
import { MeetingExtractSchema } from '../extract-schema';

describe('MeetingExtractSchema', () => {
  it('parses a full flat-atom object with all five arrays', () => {
    const parsed = MeetingExtractSchema.parse({
      title: 'Q3 全体会議',
      purpose: '四半期の進捗確認',
      decisions: [{ text: 'プロプランを3,480円に値上げする', made_by: 1, ts: 12 }],
      action_items: [{ task: '負荷試験をステージングで実施', owner: 2, due: '10月14日', ts: 30 }],
      key_figures: [{ label: 'MRR', value: '4,200万円', ts: 5 }],
      open_questions: [{ text: '英語版の出荷時期は？', asked_by: 3, ts: 40 }],
      risks: [{ text: 'バックエンドの負荷が懸念', raised_by: 2, ts: 50 }],
    });
    expect(parsed.decisions).toHaveLength(1);
    expect(parsed.key_figures?.[0]?.value).toBe('4,200万円');
  });

  it('accepts empty arrays and omitted optional scalars', () => {
    const parsed = MeetingExtractSchema.parse({
      decisions: [], action_items: [], key_figures: [], open_questions: [], risks: [],
    });
    expect(parsed.title).toBeUndefined();
  });

  it('rejects a `from` field on atoms (provenance is post-decode only)', () => {
    expect(() =>
      MeetingExtractSchema.parse({
        decisions: [{ text: 'x', ts: 0, from: 'transcript' }],
        action_items: [], key_figures: [], open_questions: [], risks: [],
      }),
    ).toThrow();
  });
});
