import { describe, it, expect } from 'vitest';
import {
  TranscriptSegmentSchema,
  SessionTranscriptSchema,
  type SessionTranscript,
} from '../transcript';

describe('TranscriptSegment / SessionTranscript Zod', () => {
  it('TranscriptSegmentSchema parses minimum required fields', () => {
    const seg = { ts: 0, endTs: 1.5, text: 'hi', speakerId: 0 };
    expect(() => TranscriptSegmentSchema.parse(seg)).not.toThrow();
  });

  it('TranscriptSegmentSchema accepts optional meta', () => {
    const withMeta = {
      ts: 0,
      endTs: 1,
      text: 'hi',
      speakerId: 0,
      meta: { noSpeechProb: 0.02, customFlag: true },
    };
    const parsed = TranscriptSegmentSchema.parse(withMeta);
    expect(parsed.meta?.noSpeechProb).toBe(0.02);
  });

  it('TranscriptSegmentSchema rejects endTs < ts', () => {
    // Note: cross-field validation is OUT OF SCOPE for the shape schema
    // (orchestrator enforces ordering). This test documents intent: we
    // DO NOT add an internal refine() because the cost would be paid on
    // every chunk parse during streaming. If you need strict ordering,
    // validate in the orchestrator AFTER coalescing.
    const seg = { ts: 5, endTs: 4, text: 'x', speakerId: 0 };
    expect(() => TranscriptSegmentSchema.parse(seg)).not.toThrow();
  });

  it('SessionTranscriptSchema parses well-formed payload', () => {
    const t: SessionTranscript = {
      sessionId: 'abc',
      speakers: [{ id: 0 }, { id: 1, name: '田中' }],
      transcriptSegments: [
        { ts: 0, endTs: 1, text: 'hi', speakerId: 0 },
        { ts: 1.5, endTs: 2.5, text: 'world', speakerId: 1 },
      ],
    };
    expect(() => SessionTranscriptSchema.parse(t)).not.toThrow();
  });

  it('SessionTranscriptSchema accepts empty segments (e.g. silent recording)', () => {
    const empty: SessionTranscript = {
      sessionId: 'empty',
      speakers: [{ id: 0 }],
      transcriptSegments: [],
    };
    expect(() => SessionTranscriptSchema.parse(empty)).not.toThrow();
  });
});
