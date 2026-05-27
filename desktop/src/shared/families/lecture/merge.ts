import type { MergeStrategy } from '@shared/families';

/**
 * Per spec §5.2b. Lecture uses deterministic merge (no merge-LLM call):
 * - Top-level scalars: longest wins (title, tldr, course, lecturer).
 * - Sections: concat-only with sortByTs (sections are unique per ts range).
 * - Top-level arrays (besides sections): concat-dedup (defensive against
 *   future schema additions like top-level key_takeaways).
 * - Extras (per-section slot array): concat-dedup (typed slots dedup
 *   across chunks — e.g. formula mentioned in 2 chunks → 1).
 */
export const lectureMergeStrategy: MergeStrategy = {
  scalarPolicy: 'longest',
  arrayPolicy: 'concat-dedup',
  sortByTs: true,
  fieldOverrides: {
    sections: { policy: 'concat-only' },
    extras: { policy: 'concat-dedup' },
  },
};
