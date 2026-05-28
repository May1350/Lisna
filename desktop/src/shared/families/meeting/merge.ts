import type { MergeStrategy } from '@shared/families';

/**
 * Per spec §5.2b. Meeting uses fully deterministic merge (no merge-LLM call):
 * - Top-level scalars: longest wins (title, executive_summary, etc.).
 * - Top-level arrays default: concat-dedup.
 * - fieldOverrides cover the five fields whose policy deviates from the default:
 *   topic_arc, discussions — concat-only (temporal, order preserved, no dedup);
 *   decisions, proposals, next_steps — concat-dedup (explicit override for clarity).
 *
 * Arrays NOT listed in fieldOverrides (open_questions, risks_or_concerns,
 * conclusions, participants, agenda) inherit the top-level arrayPolicy
 * 'concat-dedup' — intentionally omitted per spec §5.2b.
 */
export const meetingMergeStrategy: MergeStrategy = {
  scalarPolicy: 'longest',
  arrayPolicy: 'concat-dedup',
  sortByTs: true,
  fieldOverrides: {
    topic_arc:   { policy: 'concat-only' },   // temporal arc — order preserved, no dedup
    discussions: { policy: 'concat-only' },   // unique per ts_start
    decisions:   { policy: 'concat-dedup' },
    proposals:   { policy: 'concat-dedup' },
    next_steps:  { policy: 'concat-dedup' },
  },
};
