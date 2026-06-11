import { z } from 'zod';

/**
 * Marker for fields the LLM does NOT emit during grammar-constrained decode,
 * but `loadNote()` fills post-decode. The zod-to-gbnf converter reads
 * `_def.description`, JSON.parses it, and skips any field whose object has
 * `postDecodeOnly: true`. Zod v3 has no `.meta()` — `.describe(...)` is the
 * v3 metadata channel.
 *
 * See spec §2.8 and `zod-to-gbnf.ts` filter logic.
 */
export const POST_DECODE_MARKER_DESCRIPTION = JSON.stringify({ postDecodeOnly: true });

/**
 * Helper to mark a Zod schema as post-decode-only. Equivalent to
 * `.describe(POST_DECODE_MARKER_DESCRIPTION)` but signals intent at the
 * call site.
 */
export function postDecodeOnly<T extends z.ZodTypeAny>(schema: T): T {
  // .describe() returns the same node type with description set on _def.
  return schema.describe(POST_DECODE_MARKER_DESCRIPTION) as T;
}

/** Provenance: where this leaf came from. Computed post-hoc per spec §2.7. */
export const ProvenanceSchema = postDecodeOnly(z.enum(['transcript', 'inferred']));
export type Provenance = z.infer<typeof ProvenanceSchema>;

/** Speaker reference: integer index into SessionTranscript.speakers[].id. */
export const SpeakerRefSchema = z.number().int().nonnegative();
export type SpeakerRef = z.infer<typeof SpeakerRefSchema>;

/** Note families — closed enum. Adding a family = bump this + add registry entry. */
export const NoteFamilySchema = z.enum(['lecture', 'meeting', 'interview', 'brainstorm']);
export type NoteFamily = z.infer<typeof NoteFamilySchema>;

/** Output / display language. */
export const LanguageSchema = z.enum(['ja', 'en', 'ko']);
export type NoteLanguage = z.infer<typeof LanguageSchema>;

/**
 * Common fields every family inherits. Per spec §3.1.
 * - `experimentArmId` is set by orchestrator at generation time. Lifecycle
 *   detail in spec §3.1 NoteBase comment.
 * - `validation_warnings` (user-visible) is distinct from
 *   GenerationTelemetry.validationWarnings (ops). See §3.1.
 */
export const NoteBaseSchema = z.object({
  schemaVersion: z.number().int().positive(),
  family: NoteFamilySchema,
  title: z.string().min(1),
  generatedAt: z.string(),                          // ISO datetime
  generatedBy: z.object({
    model: z.string(),
    promptVersion: z.number().int().nonnegative(),
  }),
  language: LanguageSchema,
  durationSec: z.number().nonnegative(),
  experimentArmId: z.string().optional(),
  validation_warnings: z.array(z.string()).optional(),
});
export type NoteBase = z.infer<typeof NoteBaseSchema>;
