import { z } from 'zod';
import { ProvenanceSchema, SpeakerRefSchema, postDecodeOnly } from '@shared/note-schema';
import { PurposeDrivenNoteSchema } from '../util/purpose-driven';

// Bounds calibrated per spec §3.6 + Path G budget locks.
const MAX_IDEA_CLUSTERS = 15;
const MAX_IDEAS_PER_CLUSTER = 30;
const MAX_PARKING_LOT = 20;

/** Spec §3.6. BrainstormNote overlay on PurposeDrivenNote. ideas[].id is post-decode (UUID-v4 via assignBrainstormIdeaIds). No decisions field — brainstorm is divergent by nature. */
export const BrainstormNoteSchema = PurposeDrivenNoteSchema.extend({
  family: z.literal('brainstorm'),
  idea_clusters: z.array(
    z.object({
      theme: z.string().max(120),
      ideas: z
        .array(
          z.object({
            id: postDecodeOnly(z.string().uuid()),
            text: z.string().max(1000),
            contributed_by: SpeakerRefSchema.optional(),
            ts: z.number().nonnegative(),
            from: ProvenanceSchema,
          }),
        )
        .min(1)
        .max(MAX_IDEAS_PER_CLUSTER),
    }),
  ).max(MAX_IDEA_CLUSTERS),
  parking_lot: z
    .array(
      z.object({
        text: z.string().max(800),
        ts: z.number().nonnegative(),
        from: ProvenanceSchema,
      }),
    )
    .max(MAX_PARKING_LOT)
    .optional(),
  atmosphere: z.enum(['collaborative', 'energetic', 'subdued']).optional(),
}).strict();

export type BrainstormNote = z.infer<typeof BrainstormNoteSchema>;
