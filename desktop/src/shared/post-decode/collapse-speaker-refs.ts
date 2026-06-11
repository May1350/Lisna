/**
 * Deterministic speaker-ref normalization for diarization-less sessions
 * (founder P1, 2026-06-10).
 *
 * When diarizationStatus !== 'ok' the transcript is degraded to a single
 * speaker (degradeToSingleSpeaker → speakers = [{ id: 0 }]), but the model
 * can still hallucinate 話者1〜N into SpeakerRef slots: the grammar emits
 * plain json-number and SpeakerRefSchema accepts any nonnegative int, so
 * invented refs pass every validation layer and render as phantom speakers.
 * Prompt instructions alone don't stop this — the interview system prompt
 * even pushes the model toward distinct asked_by/answered_by. Normalizing
 * post-merge is the only reliable layer.
 *
 * Mutates in place (same convention as the pipeline's fill/drop walks).
 */

/** Every SpeakerRef-typed scalar field across the four family schemas. */
const SPEAKER_REF_KEYS = new Set([
  'speakerRef',      // interview/meeting participants, quotable_lines
  'asked_by',        // interview qa_pairs, meeting open_questions
  'answered_by',     // interview qa_pairs
  'made_by',         // meeting decisions
  'proposed_by',     // meeting proposals
  'raised_by',       // meeting risks_or_concerns
  'owner',           // purpose-driven next_steps
  'contributed_by',  // brainstorm ideas
]);

/** SpeakerRef-array fields (meeting topic_arc.speakers_involved). */
const SPEAKER_REF_ARRAY_KEYS = new Set(['speakers_involved']);

export function collapseSpeakerRefsToZero(node: unknown): void {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) collapseSpeakerRefsToZero(child);
    return;
  }
  const o = node as Record<string, unknown>;
  for (const key of Object.keys(o)) {
    const v = o[key];
    if (SPEAKER_REF_KEYS.has(key) && typeof v === 'number') {
      o[key] = 0;
    } else if (SPEAKER_REF_ARRAY_KEYS.has(key) && Array.isArray(v)) {
      o[key] = v.length > 0 ? [0] : [];
    } else {
      collapseSpeakerRefsToZero(v);
    }
  }
}
