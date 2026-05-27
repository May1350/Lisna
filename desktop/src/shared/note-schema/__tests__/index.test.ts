import { describe, it, expect } from 'vitest';
import {
  POST_DECODE_MARKER_DESCRIPTION,
  ProvenanceSchema,
  NoteBaseSchema,
  TranscriptSegmentSchema,
  SessionTranscriptSchema,
  GenerationTelemetrySchema,
  estimateTokens,
  chunkTranscript,
  computeProvenance,
  hydratePostDecode,
  zodToGbnf,
} from '../index';

describe('note-schema barrel', () => {
  it('exports the full Plan 2 surface', () => {
    expect(POST_DECODE_MARKER_DESCRIPTION).toBe(JSON.stringify({ postDecodeOnly: true }));
    expect(ProvenanceSchema).toBeDefined();
    expect(NoteBaseSchema).toBeDefined();
    expect(TranscriptSegmentSchema).toBeDefined();
    expect(SessionTranscriptSchema).toBeDefined();
    expect(GenerationTelemetrySchema).toBeDefined();
    expect(typeof estimateTokens).toBe('function');
    expect(typeof chunkTranscript).toBe('function');
    expect(typeof computeProvenance).toBe('function');
    expect(typeof hydratePostDecode).toBe('function');
    expect(typeof zodToGbnf).toBe('function');
  });
});
