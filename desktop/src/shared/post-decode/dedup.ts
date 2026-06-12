/**
 * Deterministic near-duplicate detection shared by the post-decode pipeline
 * (Stage 3.8, Task 9) and the eval rig's loop metric (spec
 * 2026-06-12-v2-track2-sampler-alignment sections 6a + 7). One normalization,
 * one similarity — pipeline and metric MUST agree (lockstep requirement; the
 * #114 incident taught us split heuristics burn retries on healthy output).
 *
 * No imports beyond stdlib — kept dependency-free so Task 9 can consume this
 * from the pipeline without adding any transitive weight.
 */

/** NFKC → lowercase → strip everything that isn't a letter/number in any
 *  script (punctuation, whitespace, symbols out; JA/latin/digits stay). */
export function normalizeForDedup(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function trigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + 3 <= s.length; i++) out.add(s.slice(i, i + 3));
  return out;
}

/** Char-trigram Jaccard over normalized text; <3-char strings compare exact. */
export function trigramJaccard(aRaw: string, bRaw: string): number {
  const a = normalizeForDedup(aRaw);
  const b = normalizeForDedup(bRaw);
  if (a.length < 3 || b.length < 3) return a === b ? 1 : 0;
  const ta = trigrams(a);
  const tb = trigrams(b);
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Spec 6a threshold: ≥ 0.85 = duplicate (tunable; keep one constant). */
export const NEAR_DUP_THRESHOLD = 0.85;

/** Fraction of items that near-dup an EARLIER item (loop metric, spec 7). */
export function nearDupRate(texts: string[], threshold = NEAR_DUP_THRESHOLD): number {
  if (texts.length === 0) return 0;
  let dups = 0;
  for (let i = 1; i < texts.length; i++) {
    for (let j = 0; j < i; j++) {
      if (trigramJaccard(texts[i]!, texts[j]!) >= threshold) {
        dups++;
        break;
      }
    }
  }
  return dups / texts.length;
}
