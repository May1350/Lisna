import { describe, it, expect } from 'vitest';
import { dedupFitArray } from '../cap-fit';

// Genuinely trigram-distinct words (low pairwise overlap) so the dedup pass
// does NOT fire — isolates pure cap-slice behavior. (A `topic ${i}` pattern
// would near-dup since the shared prefix dominates the trigrams.)
const DISTINCT = [
  'alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel',
  'india', 'juliet', 'kilo', 'lima', 'mike', 'november', 'oscar', 'papa',
  'quebec', 'romeo', 'sierra', 'tango', 'uniform', 'victor', 'whiskey', 'xray',
  'yankee', 'zulu', 'mango', 'pixel', 'quartz', 'walnut',
];

describe('dedupFitArray', () => {
  it('slices to cap when over (distinct items, no dedup)', () => {
    const arr = DISTINCT.map((w) => ({ text: w })); // 30 distinct
    const { kept, stats } = dedupFitArray(arr, (x) => x.text, 20);
    expect(kept.length).toBe(20);
    expect(stats.deduped).toBe(0);
    expect(stats.truncated).toBe(10);
  });

  it('is a no-op when at/under cap with distinct items', () => {
    const arr = DISTINCT.slice(0, 8).map((w) => ({ text: w }));
    const { kept, stats } = dedupFitArray(arr, (x) => x.text, 20);
    expect(kept.length).toBe(8);
    expect(stats.deduped).toBe(0);
    expect(stats.truncated).toBe(0);
  });

  it('dedups near-duplicates (trigram jaccard >= 0.7) before the cap', () => {
    // "キャッシュフロー計算書" vs "キャッシュフロー計算書の作成" → jaccard ~0.75 (rung-1 fixture)
    const arr = [
      { text: 'キャッシュフロー計算書' },
      { text: 'キャッシュフロー計算書の作成' },
      { text: '貸借対照表の構造' },
    ];
    const { kept, stats } = dedupFitArray(arr, (x) => x.text, 20);
    expect(stats.deduped).toBe(1);
    expect(kept.length).toBe(2);
    // first occurrence of the near-dup cluster is kept
    expect(kept[0]!.text).toBe('キャッシュフロー計算書');
    expect(kept[1]!.text).toBe('貸借対照表の構造');
  });

  it('is order-preserving: keeps the first survivors after dedup', () => {
    const arr = [
      { id: 1, text: 'revenue grew strongly this quarter' },
      { id: 2, text: 'costs were reduced across the board' },
      { id: 3, text: 'revenue grew strongly this quarter' }, // exact dup of 1
      { id: 4, text: 'new market entry is planned' },
    ];
    const { kept, stats } = dedupFitArray(arr, (x) => x.text, 2);
    expect(stats.deduped).toBe(1); // id 3 removed
    expect(stats.truncated).toBe(1); // id 4 dropped by cap (2 survivors fit, was 3)
    expect(kept.map((k) => k.id)).toEqual([1, 2]);
  });

  it('dedup happens before the cap (a near-dup does not consume a cap slot)', () => {
    const arr = [
      { text: 'alpha topic discussion' },
      { text: 'alpha topic discussion!' }, // near-dup of first
      { text: 'beta topic review' },
      { text: 'gamma topic plan' },
    ];
    const { kept, stats } = dedupFitArray(arr, (x) => x.text, 3);
    expect(stats.deduped).toBe(1);
    expect(kept.length).toBe(3); // 3 unique survivors, all fit
    expect(stats.truncated).toBe(0);
  });

  it('does not over-dedup short keys (< 3 chars → empty trigrams)', () => {
    // Numeric speakerRef-style keys "0".."19" are all < 3 chars → empty trigram
    // sets; jaccard(∅,∅)=1 would collapse them to one. They must stay distinct.
    const arr = Array.from({ length: 20 }, (_, i) => ({ ref: i }));
    const { kept, stats } = dedupFitArray(arr, (x) => String(x.ref), 12);
    expect(stats.deduped).toBe(0);
    expect(kept.length).toBe(12); // cap-slice only, no false dedup
  });
});
