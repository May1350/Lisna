import type { TranscriptSegment as LegacySegment } from '@shared/types';
import type { SessionTranscript, TranscriptSegment as V2Segment } from './transcript';

/**
 * Adapt legacy STT segments (startSec/endSec/text/noSpeechProb?) to a v2
 * SessionTranscript. The live alpha path is pre-diarization → single speaker
 * (speakerId = 0).
 *
 * Lifted from session-finalize.ts. 3rd call site (routeLecture, routeMeeting,
 * chunked-note.ts) → architecture.md DRY extraction threshold met.
 */
export function adaptToV2Transcript(
  legacySegs: readonly LegacySegment[],
  sessionId: string,
): SessionTranscript {
  const v2Segs: V2Segment[] = legacySegs.map((s) => ({
    ts: s.startSec,
    endTs: s.endSec,
    text: s.text,
    speakerId: 0,
    meta: typeof s.noSpeechProb === 'number' ? { noSpeechProb: s.noSpeechProb } : undefined,
  }));
  return {
    sessionId,
    speakers: [{ id: 0 }],
    transcriptSegments: v2Segs,
  };
}
