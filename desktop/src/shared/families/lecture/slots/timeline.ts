import { z } from 'zod';
import { ProvenanceSchema } from '@shared/note-schema';
import type { SlotSchemaDefinition } from '@shared/families';

const MAX_EVENTS = 15;

export const TimelineSchema = z.object({
  type: z.literal('timeline'),
  events: z.array(z.object({
    when: z.string().min(1),
    text: z.string().min(1),
    ts: z.number().nonnegative(),
    from: ProvenanceSchema,
  })).min(2).max(MAX_EVENTS),
});

export type Timeline = z.infer<typeof TimelineSchema>;

export const timelineSlot: SlotSchemaDefinition<Timeline> = {
  type: 'timeline',
  schema: TimelineSchema,
  promptHint:
    'If the lecture references multiple historical events with dates, emit a timeline extra with the events in chronological order.',
  triggers: ['年', '世紀', '初頭', '末期', '時代'],
};
