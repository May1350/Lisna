import type { FixtureMeta, FixtureTranscript } from '../fixtures/_schema';
import type { SessionTranscript } from '../../src/shared/note-schema/transcript';

/**
 * Adapt an eval FixtureTranscript to the pipeline's SessionTranscript.
 * endTs = next segment's ts, or (last) ts + bucket_seconds. sessionId is
 * synthesized from the optional transcript id, else the fixture id.
 */
export function fixtureToSessionTranscript(
  ft: FixtureTranscript,
  meta: FixtureMeta,
): SessionTranscript {
  const segs = ft.transcripts;
  return {
    sessionId: ft.sessionId ?? meta.fixtureId,
    speakers: ft.speakers,
    transcriptSegments: segs.map((s, i) => ({
      ts: s.ts,
      endTs: segs[i + 1]?.ts ?? s.ts + ft.bucket_seconds,
      text: s.text,
      speakerId: s.speakerId,
    })),
  };
}
