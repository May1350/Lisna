import { describe, it, expect } from 'vitest';
import { estimateTokens } from '../tokens';

describe('estimateTokens — extended CJK coverage', () => {
  it('hiragana + katakana + CJK basic (regression vs Spike 0.4)', () => {
    // 5 hiragana chars × 0.6 = 3
    expect(estimateTokens('あいうえお')).toBe(3);
  });

  it('CJK Extension A (鿀 is in BMP basic, 㐀 is in Extension A)', () => {
    // 㐀 = U+3400. Spike 0.4 regex MISSED Extension A. Now: 0.6 t/char.
    expect(estimateTokens('㐀㐁㐂㐃㐄')).toBe(3);
  });

  it('halfwidth katakana (｡ｱｲｳ｡)', () => {
    // 5 halfwidth chars × 0.6 = 3
    expect(estimateTokens('｡ｱｲｳ｡')).toBe(3);
  });

  it('fullwidth ASCII (Ａ-Ｚ range)', () => {
    // 5 fullwidth × 0.6 = 3
    expect(estimateTokens('ＡＢＣＤＥ')).toBe(3);
  });

  it('JP punctuation + ideographic space', () => {
    // 「」、。 + U+3000 ideographic space = 5 chars × 0.6 = 3
    expect(estimateTokens('「」、。　')).toBe(3);
  });

  it('pure ASCII (regression vs Spike 0.4)', () => {
    // "hello world" = 11 ASCII × 0.25 = 2.75 → ceil → 3
    expect(estimateTokens('hello world')).toBe(3);
  });

  it('mixed JA + ASCII', () => {
    // "今日hello" = 2 CJK × 0.6 + 5 ASCII × 0.25 = 1.2 + 1.25 = 2.45 → 3
    expect(estimateTokens('今日hello')).toBe(3);
  });

  it('empty string → 0', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('boundary chars between ranges do not double-count', () => {
    // Each char counted exactly once. Sentinel: 5 mixed-range chars × 0.6 + 0 ASCII = 3
    expect(estimateTokens('あ㐀ｱＡ「')).toBe(3);
  });
});
