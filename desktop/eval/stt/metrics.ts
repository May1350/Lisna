/** Levenshtein edit distance over an array of tokens. */
export function editDistance<T>(a: T[], b: T[]): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

/** Character Error Rate (primary metric for Japanese — no word boundaries).
 *  `[...s]` iterates by code point, correct for CJK + surrogate pairs.
 *  Intentionally UNCAPPED per WER/CER convention: insertions can push the rate
 *  above 1.0 (a hyp far longer than ref → CER > 100%, e.g. scorecard prints
 *  CER=400.0%). That is correct, not a bug. */
export function cer(ref: string, hyp: string): number {
  const r = [...ref];
  if (r.length === 0) return [...hyp].length === 0 ? 0 : 1;
  return editDistance(r, [...hyp]) / r.length;
}

/** Normalize for a fairer JA CER: NFKC-fold (full-width→half-width digits/
 *  letters, ％→%, etc.) then drop whitespace, commas, and JA/ASCII punctuation.
 *  Isolates real word/proper-noun errors from trivial formatting differences
 *  (4,200 vs 4200, ％ vs %, 、。 vs none) that a raw code-point CER over-counts. */
export function normalizeForCer(s: string): string {
  return s.normalize('NFKC').replace(/[-\s,.、。・…「」『』()【】!?~〜]/gu, '');
}

/** Word Error Rate (whitespace tokenization; secondary for JA). */
export function wer(ref: string, hyp: string): number {
  const r = ref.trim().split(/\s+/).filter(Boolean);
  const h = hyp.trim().split(/\s+/).filter(Boolean);
  if (r.length === 0) return h.length === 0 ? 0 : 1;
  return editDistance(r, h) / r.length;
}
