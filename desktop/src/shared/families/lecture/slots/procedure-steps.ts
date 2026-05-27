import { z } from 'zod';
import { ProvenanceSchema } from '@shared/note-schema';
import type { SlotSchemaDefinition } from '@shared/families';

const MAX_STEPS = 20;

export const ProcedureStepsSchema = z.object({
  type: z.literal('procedure_steps'),
  steps: z.array(z.object({
    order: z.number().int().positive(),
    text: z.string().min(1),
    ts: z.number().nonnegative(),
    from: ProvenanceSchema,
  })).min(1).max(MAX_STEPS),
});

export type ProcedureSteps = z.infer<typeof ProcedureStepsSchema>;

export const procedureStepsSlot: SlotSchemaDefinition<ProcedureSteps> = {
  type: 'procedure_steps',
  schema: ProcedureStepsSchema,
  promptHint:
    'If the lecture describes an ordered procedure (recipe / algorithm / lab protocol), emit a procedure_steps extra with each step in order.',
  triggers: ['手順', '工程', '次に', 'まず', '最後に', 'ステップ'],
};
