import { z } from 'zod';
import { ProvenanceSchema } from '@shared/note-schema';
import type { SlotSchemaDefinition } from '@shared/families';

const MAX_EXPRESSION_CHARS = 240;

export const FormulaSchema = z.object({
  type: z.literal('formula'),
  expression: z.string().min(1).max(MAX_EXPRESSION_CHARS),
  label: z.string().optional(),
  derivation_steps: z.array(z.string()).max(8).optional(),
  ts: z.number().nonnegative(),
  from: ProvenanceSchema,
});

export type Formula = z.infer<typeof FormulaSchema>;

export const formulaSlot: SlotSchemaDefinition<Formula> = {
  type: 'formula',
  schema: FormulaSchema,
  promptHint:
    'If the lecture writes or speaks a mathematical formula, emit a formula extra. CRITICAL: the expression field MUST be the formula AS SPOKEN/WRITTEN in the lecture (LaTeX-style fine). NEVER use a generic placeholder like "E=mc^2" unless the lecture is literally about that formula. If the lecture content doesn\'t contain a formula, do not invent one.',
  triggers: ['式', '公式', '方程式', 'イコール', 'パイ', 'シグマ', 'インテグラル'],
};
