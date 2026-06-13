/**
 * cap-fit — deterministic, LLM-free dedup + cap enforcement for conversation
 * note arrays (meeting / interview / brainstorm).
 *
 * Called after `deterministicMerge`, before `fam.schema.parse`, so a long (2h)
 * recording whose merged arrays exceed a schema `.max()` bound cannot throw
 * `too_big` and lose the whole finalize. The merge policies (`concat-only` /
 * `concat-dedup`) union partials but never enforce `.max`, so without this pass
 * any capped array can overflow at scale.
 *
 * Rung-X (2026-06-14). Mirrors the dedup shape of `consolidate-lecture-sections.ts`
 * (rung-1) but for flat top-level arrays: dedup near-duplicates by trigram
 * jaccard, then slice to the cap. Order-preserving; no LLM (no fabrication surface).
 */
import { trigrams, jaccard } from './deterministic-merge';

/** Trigram similarity threshold for near-duplicate detection (matches rung-1). */
const DEDUP_T = 0.7;

export interface CapFitStats {
  /** Items removed as near-duplicates (trigram jaccard >= DEDUP_T on keyFn). */
  deduped: number;
  /** Items dropped by the cap after dedup. */
  truncated: number;
}

/**
 * Dedup near-duplicate items (by `keyFn` trigram similarity), then slice to `cap`.
 * Deterministic + order-preserving: keeps the first occurrence of each near-dup
 * cluster, then the first `cap` survivors. Pure — never mutates `arr`.
 *
 * Items whose `keyFn` strings are distinct never dedup, so passing a unique key
 * (e.g. `String(id)`) degrades cleanly to a plain cap-slice.
 */
export function dedupFitArray<T>(
  arr: readonly T[],
  keyFn: (x: T) => string,
  cap: number,
): { kept: T[]; stats: CapFitStats } {
  const kept: { item: T; tg: Set<string> }[] = [];
  let deduped = 0;
  for (const x of arr) {
    const tg = trigrams(keyFn(x));
    if (kept.some((k) => jaccard(tg, k.tg) >= DEDUP_T)) {
      deduped++;
      continue;
    }
    kept.push({ item: x, tg });
  }
  const survivors = kept.map((k) => k.item);
  const truncated = Math.max(0, survivors.length - cap);
  return { kept: survivors.slice(0, cap), stats: { deduped, truncated } };
}
