import { describe, it, expect } from 'vitest';
import { faithfulnessPrepass, JA_FLIP_MIN_RATIO } from './faithfulness-prepass';

describe('faithfulnessPrepass', () => {
  const transcript = '月次の売上は前年比で減少した。原価率の改善を最優先にする。';

  it('flags a wholesale JA→EN flip (jaRatio below threshold)', () => {
    const note = { qa_pairs: [{ question: 'What is the revenue trend?', answer: 'It declined year over year and margins compressed.' }] };
    const r = faithfulnessPrepass(note, transcript);
    expect(r.languageFlip).toBe(true);
    expect(r.jaRatio).toBeLessThan(JA_FLIP_MIN_RATIO);
  });

  it('does NOT flag a healthy JA note', () => {
    const note = { qa_pairs: [{ question: '売上の状況は', answer: '前年比で減少した' }], themes: [{ name: '原価率の改善' }] };
    const r = faithfulnessPrepass(note, transcript);
    expect(r.languageFlip).toBe(false);
    expect(r.jaRatio).toBeGreaterThanOrEqual(JA_FLIP_MIN_RATIO);
  });

  it('reports JA grounding: a kanji run present in the transcript counts', () => {
    const note = { themes: [{ name: '売上' }, { name: '架空の数値' }] };
    const r = faithfulnessPrepass(note, transcript);
    // 売上 is in the transcript; 架空 / 数値 are not — grounding < 1.
    expect(r.groundingJa).toBeGreaterThan(0);
    expect(r.groundingJa).toBeLessThan(1);
  });

  it('ignores system keys (family/model/generatedAt) when scoring', () => {
    const note = { family: 'interview', model: 'llama-3.2-3b', generatedAt: '2026-06-13T00:00:00Z', themes: [{ name: '売上' }] };
    const r = faithfulnessPrepass(note, transcript);
    // Only 売上 contributes — jaRatio is ~1.0, not diluted by the EN system values.
    expect(r.jaRatio).toBeGreaterThan(0.8);
  });
});
