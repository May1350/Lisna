import type { SessionTranscript } from '@shared/note-schema/transcript';

/**
 * User-visible warning surfaced when diarization was unavailable and all
 * segments have been collapsed to a single speaker.
 *
 * Exported so the orchestrator can bubble it into note.validation_warnings
 * and tests can assert the exact string without duplicating it.
 */
export const SINGLE_SPEAKER_WARNING =
  'Speaker labels disabled: diarization was unavailable for this session, so all segments are attributed to a single speaker.';

/**
 * Collapse a multi-speaker transcript to a single speaker.
 *
 * Called by the Meeting orchestrator (Task 6) when Plan 4 diarization is
 * unavailable (NoOpDiarization / runtime failure / disabled). Returns a new
 * SessionTranscript with every speakerId set to 0 and the speakers list
 * reduced to [{ id: 0, name: '話者' }], plus the warning string that the
 * orchestrator must add to note.validation_warnings.
 *
 * Pure function — does NOT mutate the passed-in transcript or its arrays.
 */
export function degradeToSingleSpeaker(
  transcript: SessionTranscript,
): { transcript: SessionTranscript; warning: string } {
  return {
    transcript: {
      ...transcript,
      speakers: [{ id: 0, name: '話者' }],
      transcriptSegments: transcript.transcriptSegments.map((s) => ({ ...s, speakerId: 0 })),
    },
    warning: SINGLE_SPEAKER_WARNING,
  };
}
