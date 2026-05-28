import { z } from 'zod';
import { NoteBaseSchema, ProvenanceSchema, SpeakerRefSchema } from '@shared/note-schema';

const MAX_CONCLUSIONS = 15;
const MAX_NEXT_STEPS = 30;

/** Spec §3.2. Shared base for Meeting / Interview / Brainstorm (3rd call site → DRY extraction). */
export const PurposeDrivenNoteSchema = NoteBaseSchema.extend({
  purpose: z.string().min(1),
  conclusions: z
    .array(
      z.object({
        text: z.string().min(1),
        ts: z.number().nonnegative().optional(),
        from: ProvenanceSchema,
      }),
    )
    .max(MAX_CONCLUSIONS)
    .optional(),
  next_steps: z
    .array(
      z.object({
        text: z.string().min(1),
        owner: SpeakerRefSchema.optional(),
        due: z.string().optional(),
        ts: z.number().nonnegative(),
        from: ProvenanceSchema,
      }),
    )
    .max(MAX_NEXT_STEPS)
    .optional(),
});
export type PurposeDrivenNote = z.infer<typeof PurposeDrivenNoteSchema>;
