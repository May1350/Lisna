// Mini Lecture schema fixture for Spike 0.1 round-trip verification.
//
// Exercises every Zod construct supported by zod-to-gbnf.ts (Tasks 1-6):
//   - ZodObject (nested)
//   - ZodArray (of objects, of discriminated unions)
//   - ZodOptional (sections.extras, tldr, items.order)
//   - ZodEnum (Provenance)
//   - ZodLiteral (Step.type, Formula.type, family)
//   - ZodDiscriminatedUnion (Extras)
//   - postDecodeOnly meta strip (KeyTerm.from)
//
// Zod v3 has no `.meta({...})`; the post-decode marker is encoded as
// `.describe(JSON.stringify({ postDecodeOnly: true }))` per Task 6 adaptation.
// zod-to-gbnf parses that description as JSON and drops any field whose object
// carries `postDecodeOnly: true` from the emitted grammar.

import { z } from 'zod';

const Provenance = z.enum(['transcript', 'inferred']);

const KeyTerm = z.object({
  term: z.string(),
  definition: z.string(),
  ts: z.number(),
  // post-decode field — should NOT appear in grammar:
  from: Provenance.describe(JSON.stringify({ postDecodeOnly: true })),
});

const Step = z.object({
  type: z.literal('procedure_steps'),
  items: z.array(z.object({ text: z.string(), order: z.number().optional() })),
});
const Formula = z.object({
  type: z.literal('formula'),
  items: z.array(z.object({ expression: z.string(), label: z.string().optional() })),
});
const Extras = z.discriminatedUnion('type', [Step, Formula]);

const Section = z.object({
  heading: z.string(),
  ts: z.number(),
  summary: z.string(),
  key_terms: z.array(KeyTerm),
  extras: z.array(Extras).optional(),
});

export const LectureMiniSchema = z.object({
  schemaVersion: z.number(),
  family: z.literal('lecture'),
  title: z.string(),
  tldr: z.string().optional(),
  sections: z.array(Section),
});

export type LectureMini = z.infer<typeof LectureMiniSchema>;
