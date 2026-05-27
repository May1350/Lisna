import { z } from 'zod';
import { SpeakerRefSchema } from './base';

/**
 * v2 transcript-segment shape (spec §3.1).
 *
 * Naming convention: camelCase with `Sec`-implied seconds (no suffix on
 * `ts`/`endTs` because they're already understood as seconds — matches
 * spec §5.2a pseudo-code and Spike 0.4 chunking.ts).
 *
 * Distinction vs the existing `desktop/src/shared/types.ts::TranscriptSegment`
 * (`startSec`/`endSec`/`text`/`noSpeechProb?`, no speakerId, no meta):
 * the legacy shape feeds the alpha single-shot path. The v2 shape is what
 * the structured-note pipeline consumes. They COEXIST during the alpha
 * overlap. Adapter direction: STT→v2 (the orchestrator builds v2 segments
 * from legacy segments after diarization adds speakerId).
 *
 * `meta?: Record<string, unknown>` is the P1 extensibility hatch — hooks
 * can attach `{ noSpeechProb }`, `{ markerFlag: 'silence-snap' }`, etc.
 * without forking the schema.
 */
export const TranscriptSegmentSchema = z.object({
  ts: z.number().nonnegative(),
  endTs: z.number().nonnegative(),
  text: z.string(),
  speakerId: SpeakerRefSchema,
  meta: z.record(z.string(), z.unknown()).optional(),
});
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;

/** Speaker entry — id is canonical, name? is user-assigned at any time. */
export const SpeakerSchema = z.object({
  id: SpeakerRefSchema,
  name: z.string().optional(),
});
export type Speaker = z.infer<typeof SpeakerSchema>;

/**
 * SessionTranscript — the sibling-artifact JSON written to
 * sessions/<id>/transcript.json. Durable source of truth; never re-LLM'd.
 */
export const SessionTranscriptSchema = z.object({
  sessionId: z.string(),
  speakers: z.array(SpeakerSchema),
  transcriptSegments: z.array(TranscriptSegmentSchema),
});
export type SessionTranscript = z.infer<typeof SessionTranscriptSchema>;
