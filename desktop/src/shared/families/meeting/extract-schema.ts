import { z } from 'zod';
import { SpeakerRefSchema } from '@shared/note-schema';

// Per-chunk caps — generous; the assembler caps the merged note to MEETING_ARRAY_CAPS.
export const MAX_EXTRACT_DECISIONS = 15;
export const MAX_EXTRACT_ACTION_ITEMS = 15;
export const MAX_EXTRACT_KEY_FIGURES = 20;
export const MAX_EXTRACT_OPEN_QUESTIONS = 15;
export const MAX_EXTRACT_RISKS = 15;

/**
 * Flat per-chunk extraction atoms. Deliberately simple so the 3B can emit it
 * reliably under a small GBNF (the 3B's strength is local extraction). NO `from`
 * provenance (filled later on the assembled note by runPostDecodePipeline). `ts`
 * is the LLM's best guess and is often 0 — the assembler anchors atoms to the
 * chunk's ts-range when ts is unreliable.
 */
export const MeetingExtractSchema = z
  .object({
    title: z.string().min(1).optional(),
    purpose: z.string().min(1).optional(),
    decisions: z
      .array(z.object({ text: z.string().min(1), made_by: SpeakerRefSchema.optional(), ts: z.number().nonnegative().optional() }).strict())
      .max(MAX_EXTRACT_DECISIONS),
    action_items: z
      .array(z.object({ task: z.string().min(1), owner: SpeakerRefSchema.optional(), due: z.string().min(1).optional(), ts: z.number().nonnegative().optional() }).strict())
      .max(MAX_EXTRACT_ACTION_ITEMS),
    key_figures: z
      .array(z.object({ label: z.string().min(1), value: z.string().min(1), ts: z.number().nonnegative().optional() }).strict())
      .max(MAX_EXTRACT_KEY_FIGURES),
    open_questions: z
      .array(z.object({ text: z.string().min(1), asked_by: SpeakerRefSchema.optional(), ts: z.number().nonnegative().optional() }).strict())
      .max(MAX_EXTRACT_OPEN_QUESTIONS),
    risks: z
      .array(z.object({ text: z.string().min(1), raised_by: SpeakerRefSchema.optional(), ts: z.number().nonnegative().optional() }).strict())
      .max(MAX_EXTRACT_RISKS),
  })
  .strict();

export type ExtractedAtoms = z.infer<typeof MeetingExtractSchema>;
