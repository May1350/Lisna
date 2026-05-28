import { z } from 'zod';
import { ProvenanceSchema, SpeakerRefSchema } from '@shared/note-schema';
import { PurposeDrivenNoteSchema } from '../util/purpose-driven';

// Bounds calibrated per spec §3.4 MeetingNote.
// Mirror lecture/schema.ts style: MAX_* constants above the schema.
const MAX_PARTICIPANTS = 12;
const MAX_TOPIC_ARC = 30;
const MAX_DISCUSSIONS = 25;
const MAX_DECISIONS = 20;
const MAX_PROPOSALS = 25;
const MAX_OPEN_QUESTIONS = 25;
const MAX_RISKS = 20;
const MAX_KEY_POINTS_PER_DISCUSSION = 12;
const MAX_AGENDA = 20;

export const MeetingNoteSchema = PurposeDrivenNoteSchema.extend({
  family: z.literal('meeting'),

  // --- §3.4 Meeting fields ---
  executive_summary: z.string().min(1),
  agenda: z.array(z.string().min(1)).max(MAX_AGENDA).optional(),
  participants: z
    .array(
      z.object({
        speakerRef: SpeakerRefSchema,
        role: z.string().optional(),
      }),
    )
    .max(MAX_PARTICIPANTS)
    .optional(),
  topic_arc: z
    .array(
      z.object({
        topic: z.string().min(1),
        ts: z.number().nonnegative(),
        speakers_involved: z.array(SpeakerRefSchema).max(MAX_PARTICIPANTS),
      }),
    )
    .max(MAX_TOPIC_ARC),
  discussions: z
    .array(
      z.object({
        topic: z.string().min(1),
        ts_start: z.number().nonnegative(),
        ts_end: z.number().nonnegative().optional(),
        summary: z.string().min(1),
        key_points: z.array(z.string().min(1)).max(MAX_KEY_POINTS_PER_DISCUSSION).optional(),
      }),
    )
    .max(MAX_DISCUSSIONS),
  decisions: z
    .array(
      z.object({
        text: z.string().min(1),
        rationale: z.string().optional(),
        ts: z.number().nonnegative(),
        made_by: SpeakerRefSchema.optional(),
        from: ProvenanceSchema,
      }),
    )
    .max(MAX_DECISIONS),
  proposals: z
    .array(
      z.object({
        text: z.string().min(1),
        proposed_by: SpeakerRefSchema.optional(),
        ts: z.number().nonnegative(),
        outcome: z.enum(['accepted', 'rejected', 'deferred', 'open']).optional(),
        from: ProvenanceSchema,
      }),
    )
    .max(MAX_PROPOSALS)
    .optional(),
  open_questions: z
    .array(
      z.object({
        text: z.string().min(1),
        ts: z.number().nonnegative(),
        asked_by: SpeakerRefSchema.optional(),
        from: ProvenanceSchema,
      }),
    )
    .max(MAX_OPEN_QUESTIONS),
  risks_or_concerns: z
    .array(
      z.object({
        text: z.string().min(1),
        raised_by: SpeakerRefSchema.optional(),
        ts: z.number().nonnegative(),
        from: ProvenanceSchema,
      }),
    )
    .max(MAX_RISKS)
    .optional(),
  atmosphere: z.enum(['collaborative', 'tense', 'enthusiastic', 'neutral']).optional(),
}).strict();

export type MeetingNote = z.infer<typeof MeetingNoteSchema>;
