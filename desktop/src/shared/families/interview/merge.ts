import type { MergeStrategy } from '@shared/families';

/**
 * Per spec section 5.2b. Interview merge:
 * - scalars: longest wins (title, subject_summary, purpose).
 * - arrays default: concat-dedup.
 * - fieldOverrides: qa_pairs concat-only (Q&A order matters; temporal, no dedup);
 *   themes merge-llm (semantic clustering of themes across chunks).
 * The merge-llm policy is a no-op until the orchestrator merge-LLM branch
 * (Plan 6 Task 13) lands, gated on the merge-LLM spike (Phase B).
 */
export const interviewMergeStrategy: MergeStrategy = {
  scalarPolicy: 'longest',
  arrayPolicy: 'concat-dedup',
  sortByTs: true,
  fieldOverrides: {
    qa_pairs: { policy: 'concat-only' },
    themes: { policy: 'merge-llm' },
  },
};
