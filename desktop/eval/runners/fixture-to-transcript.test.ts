import { it, expect } from 'vitest';
import { fixtureToSessionTranscript } from './fixture-to-transcript';
import type { FixtureMeta, FixtureTranscript } from '../fixtures/_schema';

const meta = { fixtureId: 'lec-1', family: 'lecture', language: 'ja', durationSec: 30,
  bucketSeconds: 10, scenarioTags: [], expectedSlots: [], sourceUrl: null } as FixtureMeta;

it('maps transcripts→transcriptSegments, derives endTs, carries speakers, synthesizes sessionId', () => {
  const ft = { bucket_seconds: 10, speakers: [{ id: 0 }],
    transcripts: [
      { ts: 0, text: 'いち', speakerId: 0 },
      { ts: 10, text: 'に', speakerId: 0 },
    ] } as FixtureTranscript;
  const st = fixtureToSessionTranscript(ft, meta);
  expect(st.sessionId).toBe('lec-1');                  // transcript.sessionId ?? meta.fixtureId
  expect(st.speakers).toEqual([{ id: 0 }]);
  expect(st.transcriptSegments[0]).toEqual({ ts: 0, endTs: 10, text: 'いち', speakerId: 0 });
  // last segment: no successor → ts + bucket_seconds
  expect(st.transcriptSegments[1]).toEqual({ ts: 10, endTs: 20, text: 'に', speakerId: 0 });
});
