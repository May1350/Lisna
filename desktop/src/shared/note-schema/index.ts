// Single import surface for downstream Plans (3-7). Re-exports the v2
// note-schema types, utilities, and the grammar converter.

export {
  POST_DECODE_MARKER_DESCRIPTION,
  postDecodeOnly,
  ProvenanceSchema,
  type Provenance,
  SpeakerRefSchema,
  type SpeakerRef,
  NoteFamilySchema,
  type NoteFamily,
  LanguageSchema,
  type NoteLanguage,
  NoteBaseSchema,
  type NoteBase,
} from './base';

export {
  TranscriptSegmentSchema,
  type TranscriptSegment,
  SpeakerSchema,
  type Speaker,
  SessionTranscriptSchema,
  type SessionTranscript,
} from './transcript';

export { GenerationTelemetrySchema, type GenerationTelemetry } from './telemetry';

export { estimateTokens } from './tokens';
export { chunkTranscript } from './chunking';
export { adaptToV2Transcript } from './adapt-legacy-transcript';

export {
  computeProvenance,
  DEFAULT_PROVENANCE_CONFIG,
  type ProvenanceConfig,
  type ProvenanceComputer,
} from './provenance';

export { hydratePostDecode, assignBrainstormIdeaIds } from './post-decode-hydration';
export { zodToGbnf } from './zod-to-gbnf';
export { ForwardIncompatNoteError } from './forward-incompat';
export { loadNote } from './load-note';
