// desktop/eval/fixtures/_schema.ts
import { z } from 'zod';

const FamilyEnum = z.enum(['lecture', 'meeting', 'interview', 'brainstorm']);
const LanguageEnum = z.enum(['ja', 'en', 'ko']);
const LectureSlotEnum = z.enum(['procedure_steps', 'argument_chain', 'formula', 'timeline']);

export const FixtureMetaSchema = z
  .object({
    fixtureId: z.string().min(1),                  // slug, unique within family
    family: FamilyEnum,
    language: LanguageEnum,
    durationSec: z.number().int().positive(),
    bucketSeconds: z.number().int().positive(),    // STT bucket size (10 for v1/v2 parity)
    scenarioTags: z.array(z.string()).default([]),
    expectedSlots: z.array(LectureSlotEnum).default([]),  // Lecture only; empty otherwise
    sourceUrl: z.string().url().nullable(),
    notes: z.string().optional(),                  // human comment
  })
  .superRefine((meta, ctx) => {
    if (meta.family !== 'lecture' && meta.expectedSlots.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expectedSlots'],
        message: 'expectedSlots is Lecture-only; other families have no slots',
      });
    }
  });
export type FixtureMeta = z.infer<typeof FixtureMetaSchema>;

// A coverage point's importance flag. `undefined` is treated as `true` by the
// coverage scorer — every authored point is required unless explicitly opted
// out. Mirrors the meeting decisions/actionItems `mustAppear` already in use.
const KeyTermSchema = z.union([
  z.string(),
  z.object({ term: z.string(), mustAppear: z.boolean().optional() }),
]);

export const FixtureGroundTruthSchema = z.object({
  fixtureId: z.string().min(1),
  // Faithfulness answer key (Phase 1): the COMPLETE set of true factual claims
  // from this fixture's transcript. The faithfulness judge checks every note
  // claim against this list; anything not entailed here is a fabrication.
  facts: z.array(z.string()).optional(),
  // Lecture-family ground truths
  expectedSections: z.array(z.object({ heading: z.string(), ts: z.number() })).optional(),
  expectedKeyTerms: z.array(KeyTermSchema).optional(),
  expectedFormulas: z.array(z.string()).optional(),         // anti-parroting allowlist (literal expressions actually IN this fixture)
  // Meeting/Interview/Brainstorm ground truths
  decisions: z.array(z.object({ text: z.string(), mustAppear: z.boolean() })).optional(),
  actionItems: z.array(z.object({ text: z.string(), mustAppear: z.boolean() })).optional(),
  qaPairs: z.array(z.object({ q: z.string(), a: z.string(), mustAppear: z.boolean().optional() })).optional(),
  themes: z.array(z.string()).optional(),
  ideaCount: z.number().int().nonnegative().optional(),
  participantCount: z.number().int().positive().optional(),
});
export type FixtureGroundTruth = z.infer<typeof FixtureGroundTruthSchema>;

// Normalize an expectedKeyTerms entry to { term, mustAppear } — consumers
// (coverage.ts) call this so they never branch on string-vs-object.
export function normalizeKeyTerm(k: z.infer<typeof KeyTermSchema>): { term: string; mustAppear: boolean } {
  return typeof k === 'string' ? { term: k, mustAppear: true } : { term: k.term, mustAppear: k.mustAppear ?? true };
}

// Transcript shape — mirrors v1 backend fixture for direct lift,
// extended with `speakerId` per spec §3.1 SessionTranscript.
export const FixtureTranscriptSchema = z.object({
  sessionId: z.string().optional(),
  speakers: z
    .array(z.object({ id: z.number().int().nonnegative(), name: z.string().optional() }))
    .default([{ id: 0 }]),
  bucket_seconds: z.number().int().positive(),
  transcripts: z.array(
    z.object({
      ts: z.number().nonnegative(),
      text: z.string().min(1),
      speakerId: z.number().int().nonnegative().default(0),
    }),
  ),
});
export type FixtureTranscript = z.infer<typeof FixtureTranscriptSchema>;
