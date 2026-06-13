import { z } from 'zod';
import { NoteBaseSchema, ProvenanceSchema } from '@shared/note-schema';
import { LectureSlotInstanceSchema } from './slots';

// Bounds calibrated per spec §3.5/§3.6 + Path G memo (real Lecture
// content, not arbitrary). See `decision-0.2-path-f.md` for the
// runaway-tail risk that makes these mandatory.
// Hard ceiling. The duration-aware target (clamp(ceil(min/8),10,24)) is
// enforced at merge-time consolidation (consolidate-lecture-sections.ts);
// 24 is the safety bound so a long lecture's merged sections never throw too_big.
const MAX_SECTIONS = 24;
const MAX_KEY_TERMS_PER_SECTION = 12;
const MAX_EXAMPLES_PER_SECTION = 10;
const MAX_POINTS_PER_SECTION = 20;
const MAX_HEADING_CHARS = 120;
const MAX_EXTRAS_PER_SECTION = 8;

export const LectureSectionSchema = z.object({
  heading: z.string().min(1).max(MAX_HEADING_CHARS),
  ts: z.number().nonnegative(),
  summary: z.string().min(1),
  takeaway: z.string().min(1).optional(),
  key_terms: z.array(z.object({
    term: z.string().min(1),
    definition: z.string().min(1),
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
  extras: z.array(LectureSlotInstanceSchema).max(MAX_EXTRAS_PER_SECTION).optional(),
});

export const LectureNoteSchema = NoteBaseSchema.extend({
  family: z.literal('lecture'),
  course: z.string().min(1).optional(),
  lecturer: z.string().min(1).optional(),
  tldr: z.string().min(1).optional(),
  sections: z.array(LectureSectionSchema).max(MAX_SECTIONS),
}).strict();

export type LectureNote = z.infer<typeof LectureNoteSchema>;
export type LectureSection = z.infer<typeof LectureSectionSchema>;
