import type { MergeStrategy } from '@shared/families';
import { trigrams, jaccard } from '@shared/post-decode/deterministic-merge';

// Two qa_pairs are a chunk-boundary duplicate when their questions are
// trigram-similar AND their timestamps are within this window. Tuned to catch
// the same turn re-emitted at a chunk seam, not two distinct turns that happen
// to share phrasing far apart in time.
const QA_TS_WINDOW_SEC = 2;
const QA_QUESTION_TRIGRAM_THRESHOLD = 0.7;

/**
 * Deterministic union of qa_pairs across chunk partials.
 *
 * Spike 1.1 (verdict MIXED, `desktop/spikes/phase-1/01-merge-llm/`) proved a 3B
 * model drops turns when asked to merge structured lists — worst case it
 * returned 4 of 8 qa_pairs. So Q&A turns are unioned in code, never by the LLM:
 * concatenate every chunk's turns, drop only chunk-boundary duplicates (same
 * question within `QA_TS_WINDOW_SEC`), then sort by `ts`. `merge-llm.ts` reads
 * this `custom` policy and keeps qa_pairs out of the LLM merge prompt entirely.
 */
function unionInterviewQaPairs(perChunk: unknown[]): unknown {
  const all: Array<Record<string, unknown>> = [];
  for (const chunk of perChunk) {
    if (Array.isArray(chunk)) all.push(...(chunk as Array<Record<string, unknown>>));
  }
  const kept: Array<{ item: Record<string, unknown>; ts: number; tg: Set<string> }> = [];
  for (const item of all) {
    const ts = typeof item.ts === 'number' ? item.ts : 0;
    const tg = trigrams(typeof item.question === 'string' ? item.question : '');
    const dup = kept.some(
      k => Math.abs(k.ts - ts) <= QA_TS_WINDOW_SEC && jaccard(k.tg, tg) > QA_QUESTION_TRIGRAM_THRESHOLD,
    );
    if (!dup) kept.push({ item, ts, tg });
  }
  kept.sort((a, b) => a.ts - b.ts);
  return kept.map(k => k.item);
}

/**
 * Deterministic union of participants across chunk partials, keyed by
 * `speakerRef` (a person is one roster entry regardless of how many chunks they
 * appear in). First occurrence wins. A speakerRef-keyed merge is required
 * because the default text-trigram dedup wrongly collapses distinct roster
 * entries — "interviewer" and "interviewee" are >0.7 trigram-similar.
 */
function unionParticipants(perChunk: unknown[]): unknown {
  const bySpeaker = new Map<number, Record<string, unknown>>();
  for (const chunk of perChunk) {
    if (!Array.isArray(chunk)) continue;
    for (const p of chunk as Array<Record<string, unknown>>) {
      const ref = typeof p.speakerRef === 'number' ? p.speakerRef : -1;
      if (!bySpeaker.has(ref)) bySpeaker.set(ref, p);
    }
  }
  return [...bySpeaker.values()];
}

/**
 * Per spec section 5.2b + Plan 6 Task 7 (spike 1.1 MIXED). Interview merge is a
 * HYBRID — structural/extractive fields are merged deterministically, only the
 * derived prose is synthesized by the LLM:
 * - scalars: longest wins (title, purpose, …).
 * - arrays default: concat-dedup (quotable_lines, conclusions, next_steps —
 *   extractive, lossless, no LLM).
 * - qa_pairs: `custom` — deterministic ts+question-trigram union (turns are
 *   structured; a 3B drops them — see `unionInterviewQaPairs`).
 * - participants: `custom` — deterministic speakerRef-keyed union (text-trigram
 *   dedup wrongly collapses interviewer/interviewee — see `unionParticipants`).
 * - themes / key_takeaways / subject_summary: `merge-llm` — genuinely derived
 *   prose synthesized cross-chunk by `merge-llm.ts`.
 */
export const interviewMergeStrategy: MergeStrategy = {
  scalarPolicy: 'longest',
  arrayPolicy: 'concat-dedup',
  sortByTs: true,
  fieldOverrides: {
    qa_pairs: { policy: 'custom', handler: unionInterviewQaPairs },
    participants: { policy: 'custom', handler: unionParticipants },
    themes: { policy: 'merge-llm' },
    key_takeaways: { policy: 'merge-llm' },
    subject_summary: { policy: 'merge-llm' },
  },
};
