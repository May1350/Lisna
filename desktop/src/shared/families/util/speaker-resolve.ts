import type { SpeakerRef } from '@shared/note-schema/base';
import type { SessionTranscript } from '@shared/note-schema/transcript';

/**
 * Resolve a SpeakerRef to a display string. Renderers call this at JSX
 * dereferencing time so that a user inline-rename (which mutates
 * SessionTranscript.speakers[i].name, never the speakerId) propagates instantly
 * without rewriting any segment.
 *
 * `SpeakerRef` is the canonical index type from `note-schema/base.ts` — it is
 * NOT redefined here (Plan 4's pseudo-code predated Plan 2 landing the type).
 *
 * Fallbacks:
 *   - speaker found, no name  → `Speaker {id}`
 *   - ref out of range        → `Speaker ?{ref}` (the closure validator should
 *     catch this pre-render; defensive for hand-edited notes loaded from disk).
 */
export function resolveSpeakerLabel(ref: SpeakerRef, transcript: SessionTranscript): string {
  const speaker = transcript.speakers.find((s) => s.id === ref);
  if (!speaker) return `Speaker ?${ref}`;
  return speaker.name ?? `Speaker ${speaker.id}`;
}
