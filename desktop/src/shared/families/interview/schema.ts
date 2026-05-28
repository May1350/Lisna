import { z } from 'zod';
import { ProvenanceSchema, SpeakerRefSchema } from '@shared/note-schema';
import { PurposeDrivenNoteSchema } from '../util/purpose-driven';

// Bounds calibrated per spec §3.5 + Path G budget locks.
const MAX_QA_PAIRS = 80;
const MAX_THEMES = 12;
const MAX_TS_PER_THEME = 20;
const MAX_THEMES_PER_QA = 6;
const MAX_QUOTABLE_LINES = 20;
const MAX_KEY_TAKEAWAYS = 15;
const MAX_PARTICIPANTS = 8;

/** Spec §3.5. InterviewNote overlay on PurposeDrivenNote. .max(N) bounds = Path G budget locks. */
export const InterviewNoteSchema = PurposeDrivenNoteSchema.extend({
  family: z.literal('interview'),
  subject_summary: z.string().min(1).max(3000),
  participants: z
    .array(
      z.object({
        speakerRef: SpeakerRefSchema,
        role: z.enum(['interviewer', 'interviewee']),
      }),
    )
    .max(MAX_PARTICIPANTS)
    .optional(),
  qa_pairs: z
    .array(
      z.object({
        question: z.string().max(1500),
        answer: z.string().max(3000),
        ts: z.number().nonnegative(),
        asked_by: SpeakerRefSchema,
        answered_by: SpeakerRefSchema,
        themes: z.array(z.string().max(80)).max(MAX_THEMES_PER_QA).optional(),
        from: ProvenanceSchema,
      }),
    )
    .max(MAX_QA_PAIRS),
  themes: z
    .array(
      z.object({
        name: z.string().max(120),
        description: z.string().max(500).optional(),
        appears_at_ts: z.array(z.number().nonnegative()).max(MAX_TS_PER_THEME),
      }),
    )
    .max(MAX_THEMES),
  quotable_lines: z
    .array(
      z.object({
        text: z.string().max(500),
        speakerRef: SpeakerRefSchema,
        ts: z.number().nonnegative(),
        why_notable: z.string().max(300).optional(),
      }),
    )
    .max(MAX_QUOTABLE_LINES),
  key_takeaways: z
    .array(
      z.object({
        text: z.string().max(800),
        from: ProvenanceSchema,
      }),
    )
    .max(MAX_KEY_TAKEAWAYS),
}).strict();
export type InterviewNote = z.infer<typeof InterviewNoteSchema>;
