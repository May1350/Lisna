import type { z } from 'zod';

/**
 * Schema half of a typed Lecture `extras` slot. Per spec §4.0 + §4 #15.
 *
 * `triggers` (optional regex strings) affect **prompt-hint injection only**.
 * The GBNF grammar always allows every registered slot type (spec P2).
 * This keeps grammar regeneration cost zero across user-session content
 * variation; the model learns "include this slot when transcript matches"
 * from the system-prompt hint, not from a runtime-narrowed grammar.
 *
 * Renderer-process slot rendering lives in `SlotRendererMap`
 * (see `families/renderer.tsx`), keyed by `type`. Per
 * `docs/superpowers/decisions/2026-05-28-family-definition-renderer-split.md`.
 */
export interface SlotSchemaDefinition<T> {
  type: string;
  schema: z.ZodType<T>;
  promptHint: string;
  triggers?: ReadonlyArray<string>;
}
