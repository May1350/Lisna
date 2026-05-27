import type { FamilyCoreDefinition } from '../families';
import type { NoteBase } from '../note-schema/base';
import type { SessionTranscript } from '../note-schema/transcript';
import { computeProvenance } from '../note-schema/provenance';
import {
  ForwardIncompatNoteError,
  CURRENT_SCHEMA_VERSION,
} from '../note-schema/forward-incompat';

// Re-export for backwards compat — existing callers import from this module.
export { ForwardIncompatNoteError, CURRENT_SCHEMA_VERSION };

/**
 * Run the 5-stage post-decode pipeline per spec §5.2.
 *
 * Stage 1 — JSON.parse (throws SyntaxError on malformed input — no wrap)
 * Stage 2 — Fill ids (Brainstorm only; all other families are a no-op here)
 * Stage 3 — Fill provenance (walk recursively, fill `from` on every
 *            provenance-bearing leaf that has a `ts` but no `from`)
 * Stage 4 — Zod parse with referential closure (delegates to family.schema.parse)
 * Stage 5 — Deterministic dedup (Lecture is a no-op; dedup is field-level
 *            inside MergeStrategy at the merge stage, not per-chunk)
 *
 * @param rawJson  Raw JSON string emitted by the LLM grammar-constrained decode.
 * @param family   The family's core definition (provides schema + id).
 * @param transcript  The session transcript used to infer provenance.
 * @returns The fully validated note (type matches family's schema output type).
 */
export function runPostDecodePipeline(
  rawJson: string,
  family: FamilyCoreDefinition<NoteBase>,
  transcript: SessionTranscript,
): unknown {
  // Stage 1 — JSON.parse (native SyntaxError on bad input, per spec)
  const parsed = JSON.parse(rawJson) as Record<string, unknown>;

  // Forward-incompat guard (still Stage 1)
  if (
    typeof parsed.schemaVersion === 'number' &&
    parsed.schemaVersion > CURRENT_SCHEMA_VERSION
  ) {
    throw new ForwardIncompatNoteError(parsed.schemaVersion, CURRENT_SCHEMA_VERSION);
  }

  // Stage 2 — id fill (Brainstorm only; Lecture / Meeting / Interview no-op)
  if (family.id === 'brainstorm') {
    fillBrainstormIdeaIds(parsed);
  }

  // Stage 3 — provenance fill
  fillProvenanceRecursive(parsed, transcript);

  // Stage 4 — Zod parse with referential closure
  const validated = family.schema.parse(parsed);

  // Stage 5 — deterministic dedup
  // Lecture: dedup is field-level inside MergeStrategy at the merge stage —
  // not applied per-chunk here. Other families (Plans 4-6) may add logic here.
  // Current implementation is a no-op for all families at the per-chunk stage.

  return validated;
}

/**
 * Fill missing `id` fields on Brainstorm idea objects.
 * Brainstorm-only (Plan 4). For Plans 3/5/6 (Lecture/Meeting/Interview) this
 * function is never called — Stage 2 is a no-op.
 */
function fillBrainstormIdeaIds(parsed: Record<string, unknown>): void {
  const clusters = parsed['idea_clusters'];
  if (!Array.isArray(clusters)) return;
  for (const cluster of clusters) {
    const ideas = (cluster as Record<string, unknown>)['ideas'];
    if (!Array.isArray(ideas)) continue;
    for (const idea of ideas) {
      const obj = idea as Record<string, unknown>;
      if (typeof obj['id'] !== 'string' || obj['id'] === '') {
        obj['id'] = crypto.randomUUID();
      }
    }
  }
}

/**
 * Walk the parsed note tree recursively and fill `from` on every leaf
 * that:
 *   1. Is a plain object (not an array)
 *   2. Has a numeric `ts` field
 *   3. Has `from === undefined` (not yet set)
 *   4. Has at least one discriminator field indicating it's a
 *      provenance-bearing leaf: `text`, `term`, or `expression`
 *
 * Discriminator rationale (verified against current slot schemas):
 *   - LectureSectionSchema.key_terms[]:    has `term`
 *   - LectureSectionSchema.examples[]:     has `text`
 *   - LectureSectionSchema.points[]:       has `text`
 *   - FormulaSchema:                       has `expression`
 *   - ProcedureStepsSchema.steps[]:        has `text`
 *   - ArgumentChainSchema.claims[]:        has `text`
 *   - TimelineSchema.events[]:             has `text`
 *
 * Objects that do NOT have any of these fields (e.g. the outer section
 * object, the note root) are skipped — we do not add `from` to objects that
 * don't declare it in their Zod schema.
 */
function fillProvenanceRecursive(
  obj: unknown,
  transcript: SessionTranscript,
): void {
  if (obj == null || typeof obj !== 'object') return;

  if (Array.isArray(obj)) {
    for (const child of obj) fillProvenanceRecursive(child, transcript);
    return;
  }

  const o = obj as Record<string, unknown>;

  if (
    typeof o['ts'] === 'number' &&
    o['from'] === undefined &&
    (
      'text' in o ||
      'term' in o ||
      'expression' in o
    )
  ) {
    o['from'] = computeProvenance(o as { ts: number }, transcript);
  }

  for (const key of Object.keys(o)) {
    fillProvenanceRecursive(o[key], transcript);
  }
}
