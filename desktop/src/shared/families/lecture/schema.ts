import { z } from 'zod';
import { NoteBaseSchema, ProvenanceSchema } from '@shared/note-schema';

// Bounds calibrated per spec §3.5/§3.6 + Path G memo (real Lecture
// content, not arbitrary). See `decision-0.2-path-f.md` for the
// runaway-tail risk that makes these mandatory.
const MAX_SECTIONS = 10;
const MAX_KEY_TERMS_PER_SECTION = 12;
const MAX_EXAMPLES_PER_SECTION = 10;
const MAX_POINTS_PER_SECTION = 20;
const MAX_HEADING_CHARS = 120;

export const LectureSectionSchema = z.object({
  heading: z.string().min(1).max(MAX_HEADING_CHARS),
  ts: z.number().nonnegative(),
  summary: z.string().min(0),
  takeaway: z.string().optional(),
  key_terms: z.array(z.object({
    term: z.string().min(1),
    definition: z.string().min(0),
    ts: z.number().nonnegative(),
    from: ProvenanceSchema,
  })).max(MAX_KEY_TERMS_PER_SECTION),
  examples: z.array(z.object({
    text: z.string().min(1),
    ts: z.number().nonnegative(),
    from: ProvenanceSchema,
  })).max(MAX_EXAMPLES_PER_SECTION),
  points: z.array(z.object({
    text: z.string().min(1),
    ts: z.number().nonnegative(),
    important: z.boolean(),
    from: ProvenanceSchema,
  })).max(MAX_POINTS_PER_SECTION),
});

export const LectureNoteSchema = NoteBaseSchema.extend({
  family: z.literal('lecture'),
  course: z.string().optional(),
  lecturer: z.string().optional(),
  tldr: z.string().optional(),
  sections: z.array(LectureSectionSchema).max(MAX_SECTIONS),
}).strict();

export type LectureNote = z.infer<typeof LectureNoteSchema>;
export type LectureSection = z.infer<typeof LectureSectionSchema>;
