import { computeProvenance, DEFAULT_PROVENANCE_CONFIG, type ProvenanceConfig } from './provenance';
import type { SessionTranscript } from './transcript';

/**
 * Walk a parsed JSON tree and fill `from` on every leaf that:
 *   - has a numeric `ts`, AND
 *   - does NOT already have a `from`.
 *
 * Spec §2.8 — grammar schema strips `from` (via the postDecodeOnly marker
 * on `ProvenanceSchema`); validated-note schema requires it. This function
 * is the bridge.
 *
 * Mutates the input in place. Used in Plan 3's orchestrator AFTER raw
 * JSON.parse but BEFORE Zod.parse against the full validated-note schema.
 *
 * Brainstorm `ideas[].id` UUID hydration is a SEPARATE post-decode step
 * (lands with the Brainstorm schema in Plan 6).
 */
export function hydratePostDecode(
  node: unknown,
  transcript: SessionTranscript,
  config: ProvenanceConfig = DEFAULT_PROVENANCE_CONFIG,
): void {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) hydratePostDecode(item, transcript, config);
    return;
  }
  const obj = node as Record<string, unknown>;
  // Leaf-with-ts criterion: numeric `ts` present, `from` not already set.
  if (typeof obj.ts === 'number' && obj.from === undefined) {
    obj.from = computeProvenance({ ts: obj.ts }, transcript, config);
  }
  for (const k in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) {
      hydratePostDecode(obj[k], transcript, config);
    }
  }
}
