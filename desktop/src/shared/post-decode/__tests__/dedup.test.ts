import { describe, it, expect } from 'vitest';
import { normalizeForDedup, trigramJaccard, nearDupRate } from '../dedup';

describe('normalizeForDedup', () => {
  it('NFKC + lowercase + strips whitespace/punctuation, keeps JA content chars', () => {
    expect(normalizeForDedup('就職活動、 ｱﾄﾞﾊﾞｲｽ!')).toBe('就職活動アドバイス');
    expect(normalizeForDedup('Hello,  World!')).toBe('helloworld');
  });
});

describe('trigramJaccard', () => {
  it('1.0 for identical, high for near-identical, low for unrelated', () => {
    expect(trigramJaccard('就職活動のアドバイス', '就職活動のアドバイス')).toBe(1);
    expect(trigramJaccard('就職活動のアドバイスです', '就職活動のアドバイスでした')).toBeGreaterThan(0.6);
    expect(trigramJaccard('就職活動のアドバイス', '財務戦略の基本方針')).toBeLessThan(0.2);
  });
  it('short strings (< 3 chars) compare by equality', () => {
    expect(trigramJaccard('はい', 'はい')).toBe(1);
    expect(trigramJaccard('はい', 'いえ')).toBe(0);
  });
});

describe('nearDupRate', () => {
  it('counts items whose normalized text near-dups an earlier item', () => {
    // Strings are long enough (10/11 normalized chars → 8/9 trigrams → Jaccard 8/9≈0.89)
    // to cross the 0.85 threshold. Short strings like 'Aの説明です'(6 chars) produce 0.80
    // and would not count. item 2 exact-dups item 1; item 3 near-dups (>=0.85); item 4 unique.
    const texts = [
      'Aの説明ですから大切',
      'Aの説明ですから大切',
      'Aの説明ですから大切ね',
      '全然違う内容の話題',
    ];
    expect(nearDupRate(texts, 0.85)).toBeCloseTo(2 / 4);
  });
});
