/**
 * consolidate-conversation.ts — deterministic post-merge cap-fit for the
 * conversation families (meeting / interview / brainstorm). Rung-X (2026-06-14).
 *
 * Called after `deterministicMerge`, before `fam.schema.parse`, so a long (2h)
 * recording whose UNIONED top-level arrays exceed a schema `.max()` bound cannot
 * throw `too_big` and lose the whole finalize. Each capped top-level array is run
 * through `dedupFitArray` (dedup near-dups by trigram, then slice to cap).
 *
 * Lecture has its own richer pass (`consolidate-lecture-sections.ts`, with
 * adjacency fold + sub-array dedup-fit); these three only need flat dedup+cap.
 *
 * Pure — never mutates input. Caps are imported per family (single source = the
 * schema `.max()` bounds). Per-ELEMENT nested arrays (qa_pairs[].themes,
 * discussions[].key_points, themes[].appears_at_ts) are grammar-bounded at
 * generation and never unioned across chunks, so they cannot overflow — not
 * fitted. Exception: brainstorm `idea_clusters[].ideas` IS fitted defensively
 * (the cluster array can arrive via a merge-LLM concat fallback).
 */
import { dedupFitArray, type CapFitStats } from './cap-fit';
import { type MeetingNote, MEETING_ARRAY_CAPS } from '../families/meeting/schema';
import { type InterviewNote, INTERVIEW_ARRAY_CAPS } from '../families/interview/schema';
import { type BrainstormNote, BRAINSTORM_ARRAY_CAPS } from '../families/brainstorm/schema';

/** Build a `fit` closure that applies dedupFitArray and tallies stats into `agg`. */
function makeFitter(agg: CapFitStats) {
  return function fit<T>(arr: readonly T[], keyFn: (x: T) => string, cap: number): T[] {
    const r = dedupFitArray(arr, keyFn, cap);
    agg.deduped += r.stats.deduped;
    agg.truncated += r.stats.truncated;
    return r.kept;
  };
}

export function consolidateMeetingNote(note: MeetingNote): { note: MeetingNote; stats: CapFitStats } {
  const stats: CapFitStats = { deduped: 0, truncated: 0 };
  const fit = makeFitter(stats);
  const C = MEETING_ARRAY_CAPS;
  return {
    note: {
      ...note,
      topic_arc: fit(note.topic_arc, (x) => x.topic, C.topic_arc),
      discussions: fit(note.discussions, (x) => x.topic, C.discussions),
      decisions: fit(note.decisions, (x) => x.text, C.decisions),
      open_questions: fit(note.open_questions, (x) => x.text, C.open_questions),
      ...(note.agenda ? { agenda: fit(note.agenda, (s) => s, C.agenda) } : {}),
      ...(note.participants ? { participants: fit(note.participants, (x) => String(x.speakerRef), C.participants) } : {}),
      ...(note.proposals ? { proposals: fit(note.proposals, (x) => x.text, C.proposals) } : {}),
      ...(note.risks_or_concerns ? { risks_or_concerns: fit(note.risks_or_concerns, (x) => x.text, C.risks_or_concerns) } : {}),
    },
    stats,
  };
}

export function consolidateInterviewNote(note: InterviewNote): { note: InterviewNote; stats: CapFitStats } {
  const stats: CapFitStats = { deduped: 0, truncated: 0 };
  const fit = makeFitter(stats);
  const C = INTERVIEW_ARRAY_CAPS;
  return {
    note: {
      ...note,
      qa_pairs: fit(note.qa_pairs, (x) => x.question, C.qa_pairs),
      themes: fit(note.themes, (x) => x.name, C.themes),
      quotable_lines: fit(note.quotable_lines, (x) => x.text, C.quotable_lines),
      key_takeaways: fit(note.key_takeaways, (x) => x.text, C.key_takeaways),
      ...(note.participants ? { participants: fit(note.participants, (x) => String(x.speakerRef), C.participants) } : {}),
    },
    stats,
  };
}

export function consolidateBrainstormNote(note: BrainstormNote): { note: BrainstormNote; stats: CapFitStats } {
  const stats: CapFitStats = { deduped: 0, truncated: 0 };
  const fit = makeFitter(stats);
  const C = BRAINSTORM_ARRAY_CAPS;
  // Fit each cluster's ideas first (nested), then the clusters themselves.
  const clustersFitted = note.idea_clusters.map((cl) => ({
    ...cl,
    ideas: fit(cl.ideas, (x) => x.text, C.ideas_per_cluster),
  }));
  return {
    note: {
      ...note,
      idea_clusters: fit(clustersFitted, (x) => x.theme, C.idea_clusters),
      ...(note.parking_lot ? { parking_lot: fit(note.parking_lot, (x) => x.text, C.parking_lot) } : {}),
    },
    stats,
  };
}
