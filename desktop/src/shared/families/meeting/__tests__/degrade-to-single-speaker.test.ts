import { describe, it, expect } from 'vitest';
import {
  degradeToSingleSpeaker,
  SINGLE_SPEAKER_WARNING,
} from '../degrade-to-single-speaker';
import type { SessionTranscript } from '@shared/note-schema/transcript';

const MULTI_SPEAKER_FIXTURE: SessionTranscript = {
  sessionId: 'sess-abc123',
  speakers: [
    { id: 0, name: '佐藤' },
    { id: 1, name: '田中' },
    { id: 2 },
  ],
  transcriptSegments: [
    { ts: 0.0, endTs: 5.2, text: 'こんにちは', speakerId: 0 },
    { ts: 5.5, endTs: 12.1, text: 'はじめまして', speakerId: 1, meta: { noSpeechProb: 0.02 } },
    { ts: 12.5, endTs: 18.0, text: 'よろしくお願いします', speakerId: 2 },
  ],
};

describe('degradeToSingleSpeaker', () => {
  it('collapses every segment to speakerId 0', () => {
    const { transcript } = degradeToSingleSpeaker(MULTI_SPEAKER_FIXTURE);
    for (const seg of transcript.transcriptSegments) {
      expect(seg.speakerId).toBe(0);
    }
  });

  it('replaces speakers with a single entry [{ id: 0, name: "話者" }]', () => {
    const { transcript } = degradeToSingleSpeaker(MULTI_SPEAKER_FIXTURE);
    expect(transcript.speakers).toEqual([{ id: 0, name: '話者' }]);
  });

  it('warning matches /Speaker labels disabled/ and contains no §', () => {
    const { warning } = degradeToSingleSpeaker(MULTI_SPEAKER_FIXTURE);
    expect(warning).toMatch(/Speaker labels disabled/);
    expect(warning).not.toContain('§');
    expect(warning).toBe(SINGLE_SPEAKER_WARNING);
  });

  it('preserves sessionId and per-segment ts/endTs/text/meta; only speakerId changes', () => {
    const { transcript } = degradeToSingleSpeaker(MULTI_SPEAKER_FIXTURE);
    expect(transcript.sessionId).toBe('sess-abc123');

    const orig = MULTI_SPEAKER_FIXTURE.transcriptSegments;
    const out = transcript.transcriptSegments;
    expect(out).toHaveLength(orig.length);
    orig.forEach((origSeg, i) => {
      const outSeg = out[i];
      // outSeg is defined — length already asserted equal above
      expect(outSeg?.ts).toBe(origSeg.ts);
      expect(outSeg?.endTs).toBe(origSeg.endTs);
      expect(outSeg?.text).toBe(origSeg.text);
      expect(outSeg?.meta).toEqual(origSeg.meta);
      // speakerId IS changed — verified in the first test
    });
  });

  it('does not mutate the original transcript object', () => {
    const originalSpeakers = [...MULTI_SPEAKER_FIXTURE.speakers];
    const originalSpeakerIds = MULTI_SPEAKER_FIXTURE.transcriptSegments.map((s) => s.speakerId);

    degradeToSingleSpeaker(MULTI_SPEAKER_FIXTURE);

    // speakers array reference and values unchanged
    expect(MULTI_SPEAKER_FIXTURE.speakers).toEqual(originalSpeakers);
    // segment speakerIds unchanged
    MULTI_SPEAKER_FIXTURE.transcriptSegments.forEach((seg, i) => {
      expect(seg.speakerId).toBe(originalSpeakerIds[i]);
    });
  });

  it('handles empty transcriptSegments: returns single speaker + empty segments + warning', () => {
    const empty: SessionTranscript = {
      sessionId: 'sess-empty',
      speakers: [],
      transcriptSegments: [],
    };
    const { transcript, warning } = degradeToSingleSpeaker(empty);
    expect(transcript.speakers).toEqual([{ id: 0, name: '話者' }]);
    expect(transcript.transcriptSegments).toEqual([]);
    expect(warning).toBe(SINGLE_SPEAKER_WARNING);
  });
});
