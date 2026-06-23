/**
 * Pure assembler for MeetingNote. No LLM; all logic is deterministic.
 *
 * This file is the thin orchestrator. Field-specific dedup lives in ./dedup;
 * topic-boundary synthesis lives in ./topic-synth.
 */
import type { SessionTranscript } from '@shared/note-schema';
import type { ExtractedAtoms } from './extract-schema';
import { MEETING_ARRAY_CAPS } from './schema';
import { unionKeyFigures, unionContentAtoms, isFillerAtomText } from './dedup';
import { stripSpeakerMarker, hasMixedScript, isPlaceholderAtom } from './quality-filters';
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
  // 0. Clean each chunk's atoms ONCE (strip leaked "[ts] [話者id]" markers the 3B
  //    echoes, then drop contentless filler / out-of-script garble / generic
  //    placeholder atoms). Marker-strip MUST precede filler-drop — FILLER_RE is
  //    ^…$-anchored, so "[0] [話者0] はい" would never match it (the bug that let
  //    chitchat through as decisions, 2026-06-23). Build cleanedExtracts and use
  //    it EVERYWHERE below (union + topic-synth) so object identities stay
  //    consistent for topic-synth's ts-midpoint maps.
  // -------------------------------------------------------------------------
  const keepText = (text: string): boolean =>
    text.length > 0 && !isFillerAtomText(text) && !hasMixedScript(text) && !isPlaceholderAtom(text);
  const cleanTextAtoms = <T extends { text: string }>(arr: ReadonlyArray<T>): T[] =>
    arr.map((a) => ({ ...a, text: stripSpeakerMarker(a.text) })).filter((a) => keepText(a.text));
  const cleanedExtracts = chunkExtracts.map((c) => ({
    ...c,
    atoms: {
      ...c.atoms,
      decisions: cleanTextAtoms(c.atoms.decisions),
      open_questions: cleanTextAtoms(c.atoms.open_questions),
      risks: cleanTextAtoms(c.atoms.risks),
      action_items: c.atoms.action_items
        .map((a) => ({ ...a, task: stripSpeakerMarker(a.task) }))
        .filter((a) => keepText(a.task)),
      key_figures: c.atoms.key_figures
        .map((f) => ({ ...f, label: stripSpeakerMarker(f.label), value: stripSpeakerMarker(f.value) }))
        .filter((f) => f.label.length > 0 && !isFillerAtomText(f.label) && !hasMixedScript(f.label) && !hasMixedScript(f.value)),
    },
  }));

  // -------------------------------------------------------------------------
  // 1. Union flat atoms with field-specific dedup
  // -------------------------------------------------------------------------
  // Reshape action_items.task → text up front so the union and the midpoint
  // tracking (below) operate on the same object identities.
  const actionsPerChunk = cleanedExtracts.map((c) =>
    c.atoms.action_items.map((a) => ({ text: a.task, owner: a.owner, due: a.due, ts: a.ts })),
  );
  const decisions = unionContentAtoms(cleanedExtracts.map((c) => c.atoms.decisions));
  const nextStepsRaw = unionContentAtoms(actionsPerChunk);
  const openQuestions = unionContentAtoms(cleanedExtracts.map((c) => c.atoms.open_questions));
  const risks = unionContentAtoms(cleanedExtracts.map((c) => c.atoms.risks));
  const keyFigures = unionKeyFigures(cleanedExtracts.map((c) => c.atoms.key_figures));

  // -------------------------------------------------------------------------
  // 2. Derive title + purpose
  // -------------------------------------------------------------------------
  const allTitles = cleanedExtracts.map((c) => c.atoms.title).filter((t): t is string => !!t);
  const allPurposes = cleanedExtracts.map((c) => c.atoms.purpose).filter((p): p is string => !!p);
  const longestTitle =
    allTitles.reduce<string>((best, t) => (t.length > best.length ? t : best), '') || '';
  const longestPurpose =
    allPurposes.reduce<string>((best, p) => (p.length > best.length ? p : best), '') || '';

  // -------------------------------------------------------------------------
  // 3. Topic-arc synthesis (delegates to topic-synth.ts)
  // -------------------------------------------------------------------------
  const { topic_arc, discussions } = synthesizeTopicArcAndDiscussions({
    transcript,
    chunkExtracts: cleanedExtracts,
    decisions,
    nextStepsRaw,
    openQuestions,
    risks,
    keyFigures,
    actionsPerChunk,
  });

  // -------------------------------------------------------------------------
  // 4. title + purpose (non-empty fallbacks)
  // -------------------------------------------------------------------------
  const title = longestTitle || topic_arc[0]?.topic || '会議メモ';
  const purpose = longestPurpose || '会議の記録';

  // -------------------------------------------------------------------------
  // 5. Map to note fields + apply caps
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
  // 6. executive_summary (deterministic) — counts match the CAPPED arrays the
  //    reader actually sees (not the pre-cap union counts).
  // -------------------------------------------------------------------------
  const topicLabels = topic_arc.map((t) => t.topic);
  const executive_summary =
    topicLabels.length > 0
      ? `本会議では、${topicLabels.join('、')}について議論し、${mappedDecisions.length}件の決定と${mappedNextSteps.length}件の宿題を確認した。`
      : '会議の記録';

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
