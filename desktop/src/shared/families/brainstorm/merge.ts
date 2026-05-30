import type { MergeStrategy } from '@shared/families';

/**
 * Per spec section 5.2b. Brainstorm merge:
 * - scalars: longest wins.
 * - arrays default: concat-only (divergent by nature — preserve every idea /
 *   parking_lot item, no dedup).
 * - fieldOverrides: idea_clusters merge-llm (clusters with similar themes across
 *   chunks must be unified semantically).
 * The merge-llm policy is a no-op until the orchestrator merge-LLM branch
 * (Plan 6 Task 13) lands, gated on the merge-LLM spike (Phase B).
 */
export const brainstormMergeStrategy: MergeStrategy = {
  scalarPolicy: 'longest',
  arrayPolicy: 'concat-only',
  sortByTs: true,
  fieldOverrides: {
    idea_clusters: { policy: 'merge-llm' },
  },
};
