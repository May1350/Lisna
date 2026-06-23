/**
 * Pure assembler for MeetingNote. No LLM; all logic is deterministic.
 *
 * This file is the thin orchestrator. Field-specific dedup lives in ./dedup;
 * topic-boundary synthesis lives in ./topic-synth.
 */
import type { SessionTranscript } from '@shared/note-schema';
import type { ExtractedAtoms } from './extract-schema';
import { MEETING_ARRAY_CAPS } from './schema';
import { unionKeyFigures, unionContentAtoms } from './dedup';
import { synthesizeTopicArcAndDiscussions } from './topic-synth';

/**
 * Assemble a MeetingNote-shaped plain object from per-chunk extractions.
 * Does NOT set `from` (filled by runPostDecodePipeline → fillProvenanceRecursive).
 * Sets placeholder system-meta fields so MeetingNoteSchema.parse passes.
 */
export function assembleMeetingNote(
  chunkExtracts: ReadonlyArray<{ atoms: ExtractedAtoms; tsRange: [number, number] }>,
  transcript: SessionTranscript,
): Record<string, unknown> {
  // -------------------------------------------------------------------------
  // 1. Union flat atoms with field-specific dedup
  // -------------------------------------------------------------------------
  // Reshape action_items.task → text up front so the union and the midpoint
  // tracking (below) operate on the same object identities.
  const actionsPerChunk = chunkExtracts.map((c) =>
    c.atoms.action_items.map((a) => ({ text: a.task, owner: a.owner, due: a.due, ts: a.ts })),
  );
  const decisions = unionContentAtoms(chunkExtracts.map((c) => c.atoms.decisions));
  const nextStepsRaw = unionContentAtoms(actionsPerChunk);
  const openQuestions = unionContentAtoms(chunkExtracts.map((c) => c.atoms.open_questions));
  const risks = unionContentAtoms(chunkExtracts.map((c) => c.atoms.risks));
  const keyFigures = unionKeyFigures(chunkExtracts.map((c) => c.atoms.key_figures));

  // -------------------------------------------------------------------------
  // 2. Derive title + purpose
  // -------------------------------------------------------------------------
  const allTitles = chunkExtracts.map((c) => c.atoms.title).filter((t): t is string => !!t);
  const allPurposes = chunkExtracts.map((c) => c.atoms.purpose).filter((p): p is string => !!p);
  const longestTitle =
    allTitles.reduce<string>((best, t) => (t.length > best.length ? t : best), '') || '';
  const longestPurpose =
    allPurposes.reduce<string>((best, p) => (p.length > best.length ? p : best), '') || '';

  // -------------------------------------------------------------------------
  // 3. Topic-arc synthesis (delegates to topic-synth.ts)
  // -------------------------------------------------------------------------
  const { topic_arc, discussions } = synthesizeTopicArcAndDiscussions({
    transcript,
    chunkExtracts,
    decisions,
    nextStepsRaw,
    openQuestions,
    risks,
    keyFigures,
    actionsPerChunk,
  });

  // -------------------------------------------------------------------------
  // 4. executive_summary (deterministic)
  // -------------------------------------------------------------------------
  const topicLabels = topic_arc.map((t) => t.topic);
  const executive_summary =
    topicLabels.length > 0
      ? `本会議では、${topicLabels.join('、')}について議論し、${decisions.length}件の決定と${nextStepsRaw.length}件の宿題を確認した。`
      : '会議の記録';

  // -------------------------------------------------------------------------
  // 5. title + purpose (non-empty fallbacks)
  // -------------------------------------------------------------------------
  const title = longestTitle || topic_arc[0]?.topic || '会議メモ';
  const purpose = longestPurpose || '会議の記録';

  // -------------------------------------------------------------------------
  // 6. Map to note fields + apply caps
  // -------------------------------------------------------------------------
  const mappedDecisions = decisions.slice(0, MEETING_ARRAY_CAPS.decisions).map((d) => ({
    text: d.text,
    ts: d.ts ?? 0,
    ...(d.made_by !== undefined ? { made_by: d.made_by } : {}),
  }));

  const mappedNextSteps = nextStepsRaw.slice(0, 30 /* PurposeDriven MAX_NEXT_STEPS */).map((a) => ({
    text: a.text,
    ts: a.ts ?? 0,
    ...(a.owner !== undefined ? { owner: a.owner } : {}),
    ...(a.due !== undefined ? { due: a.due } : {}),
  }));

  const mappedOpenQuestions = openQuestions.slice(0, MEETING_ARRAY_CAPS.open_questions).map((q) => ({
    text: q.text,
    ts: q.ts ?? 0,
    ...(q.asked_by !== undefined ? { asked_by: q.asked_by } : {}),
  }));

  const mappedRisks = risks.slice(0, MEETING_ARRAY_CAPS.risks_or_concerns).map((r) => ({
    text: r.text,
    ts: r.ts ?? 0,
    ...(r.raised_by !== undefined ? { raised_by: r.raised_by } : {}),
  }));

  // -------------------------------------------------------------------------
  // 7. Assemble final object (placeholders for system-owned NoteBase fields)
  // -------------------------------------------------------------------------
  return {
    // NoteBase required placeholders (overwritten later by applyGeneratedMeta)
    schemaVersion: 1,
    family: 'meeting',
    title,
    generatedAt: '',
    generatedBy: { model: '', promptVersion: 0 },
    language: 'ja',
    durationSec: 0,

    // PurposeDrivenNote
    purpose,
    ...(mappedNextSteps.length > 0 ? { next_steps: mappedNextSteps } : {}),

    // MeetingNote fields
    executive_summary,
    topic_arc: topic_arc.slice(0, MEETING_ARRAY_CAPS.topic_arc),
    discussions: discussions.slice(0, MEETING_ARRAY_CAPS.discussions),
    decisions: mappedDecisions,
    open_questions: mappedOpenQuestions,
    ...(mappedRisks.length > 0 ? { risks_or_concerns: mappedRisks } : {}),
  };
}
