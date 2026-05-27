import { z } from 'zod';

/**
 * Per spec §3.1 — observability sibling artifact at
 * sessions/<id>/telemetry.json. Plan 7 (Eval) consumes this for
 * regression scoring.
 */
export const GenerationTelemetrySchema = z.object({
  noteId: z.string(),
  modelId: z.string(),
  promptVariantId: z.string(),
  schemaVersion: z.number().int().positive(),
  generationStartedAt: z.string(),
  generationDurationMs: z.number().nonnegative(),
  chunkCount: z.number().int().nonnegative(),
  totalTokensIn: z.number().int().nonnegative(),
  totalTokensOut: z.number().int().nonnegative(),
  validationWarnings: z.array(z.string()),
  dedupHits: z.array(z.object({ field: z.string(), count: z.number().int().nonnegative() })),
  postDecodeMutations: z.array(z.object({ field: z.string(), reason: z.string() })),
});
export type GenerationTelemetry = z.infer<typeof GenerationTelemetrySchema>;
