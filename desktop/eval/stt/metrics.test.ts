import { it, expect } from 'vitest';
import { cer, wer, normalizeForCer } from './metrics';

it('cer is 0 for identical strings', () => { expect(cer('静電ポテンシャル', '静電ポテンシャル')).toBe(0); });
it('cer counts one substitution over reference length', () => { expect(cer('abc', 'abd')).toBeCloseTo(1 / 3, 6); });
it('cer counts an insertion', () => { expect(cer('abc', 'abxc')).toBeCloseTo(1 / 3, 6); });
it('cer of empty hyp against non-empty ref is 1', () => { expect(cer('abc', '')).toBe(1); });
it('wer tokenizes on whitespace', () => { expect(wer('the quick brown fox', 'the quick green fox')).toBeCloseTo(1 / 4, 6); });

it('normalizeForCer strips commas so 4,200 == 4200', () => {
  expect(normalizeForCer('4,200万円')).toBe(normalizeForCer('4200万円'));
});
it('normalizeForCer folds full-width digits/letters to half-width (NFKC)', () => {
  expect(normalizeForCer('４２００ＡＩ')).toBe('4200AI');
});
it('normalizeForCer drops JA punctuation + whitespace', () => {
  expect(normalizeForCer('はい、 そうです。')).toBe('はいそうです');
});
it('normalized CER zeroes out a pure formatting diff', () => {
  const ref = '10月14日、約17%値上げ。', hyp = '10月14日 約17％値上げ';
  expect(cer(ref, hyp)).toBeGreaterThan(0);
  expect(cer(normalizeForCer(ref), normalizeForCer(hyp))).toBe(0);
});
