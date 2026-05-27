import type { Provenance } from './base';
import type { SessionTranscript } from './transcript';

export interface ProvenanceConfig {
  /** Window in seconds around a segment's `ts` that counts as a match. */
  matchWindowSec: number;
  /** Fallback when transcript has 0 segments. */
  emptyTranscriptDefault: Provenance;
}

export const DEFAULT_PROVENANCE_CONFIG: ProvenanceConfig = {
  matchWindowSec: 3,
  emptyTranscriptDefault: 'inferred',
};

/**
 * Decide whether a generated leaf's `ts` aligns with a real transcript
 * segment. Pure function — input-output only, no side effects, no IO.
 *
 * Per spec §4.P8. The orchestrator runs this over every leaf with a `ts`
 * field after LLM decode, before final Zod parse.
 */
export function computeProvenance(
  item: { ts?: number },
  transcript: SessionTranscript,
  config: ProvenanceConfig = DEFAULT_PROVENANCE_CONFIG,
): Provenance {
  if (item.ts === undefined) return 'inferred';
  if (transcript.transcriptSegments.length === 0) return config.emptyTranscriptDefault;
  const within = transcript.transcriptSegments.some(
    seg => Math.abs(seg.ts - item.ts!) <= config.matchWindowSec,
  );
  return within ? 'transcript' : 'inferred';
}

/** Type alias for use in FamilyCoreDefinition.inferProvenance? optional override. */
export type ProvenanceComputer = typeof computeProvenance;
