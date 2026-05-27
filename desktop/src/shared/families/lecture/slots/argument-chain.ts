import { z } from 'zod';
import { ProvenanceSchema } from '@shared/note-schema';
import type { SlotSchemaDefinition } from '@shared/families';

const MAX_CLAIMS = 10;

export const ArgumentChainSchema = z.object({
  type: z.literal('argument_chain'),
  claims: z.array(z.object({
    order: z.number().int().positive(),
    text: z.string().min(1),
    supports: z.array(z.number().int().nonnegative()).max(5).optional(),
    ts: z.number().nonnegative(),
    from: ProvenanceSchema,
  })).min(2).max(MAX_CLAIMS),
});

export type ArgumentChain = z.infer<typeof ArgumentChainSchema>;

export const argumentChainSlot: SlotSchemaDefinition<ArgumentChain> = {
  type: 'argument_chain',
  schema: ArgumentChainSchema,
  promptHint:
    'If the lecture builds a multi-step argument (each step depending on a previous claim), emit an argument_chain extra with claims in order.',
  triggers: ['したがって', 'なぜなら', '前提', '結論', 'よって'],
};
