import type { z } from 'zod';
import type { ComponentType } from 'react';

/**
 * A typed Lecture `extras` slot. Per spec §4.0 + §4 #15.
 *
 * `triggers` (optional regex strings) affect **prompt-hint injection only**.
 * The GBNF grammar always allows every registered slot type (spec P2).
 * This keeps grammar regeneration cost zero across user-session content
 * variation; the model learns "include this slot when transcript matches"
 * from the system-prompt hint, not from a runtime-narrowed grammar.
 */
export interface SlotDefinition<T> {
  type: string;
  schema: z.ZodType<T>;
  renderer: ComponentType<{ items: T[] }>;
  promptHint: string;
  triggers?: ReadonlyArray<string>;
}
