import { randomUUID } from 'node:crypto';
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

/**
 * Spec §3.6 + §5.2. Assigns a UUID v4 to each idea_clusters[].ideas[] lacking an `id`;
 * preserves existing ids. Typed as Record<string,unknown> to avoid a families→note-schema
 * dep arrow; the schema parse validates id shape at the next stage.
 */
export function assignBrainstormIdeaIds(rawNote: Record<string, unknown>): Record<string, unknown> {
  if (rawNote.family !== 'brainstorm') return rawNote;
  const clusters = rawNote.idea_clusters;
  if (!Array.isArray(clusters)) return rawNote;
  return {
    ...rawNote,
    idea_clusters: clusters.map((c) => {
      if (!c || typeof c !== 'object') return c;
      const cluster = c as Record<string, unknown>;
      const ideas = cluster.ideas;
      if (!Array.isArray(ideas)) return cluster;
      return {
        ...cluster,
        ideas: ideas.map((idea) => {
          if (!idea || typeof idea !== 'object') return idea;
          const id = (idea as Record<string, unknown>).id;
          if (typeof id === 'string' && id.length > 0) return idea;
          return { ...(idea as object), id: randomUUID() };
        }),
      };
    }),
  };
}
