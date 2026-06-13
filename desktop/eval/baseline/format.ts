import { z } from 'zod';

const ContractFindingSchema = z.object({
  ruleId: z.string(),
  severity: z.enum(['error', 'warning']),
  pass: z.boolean(),
  message: z.string(),
  detail: z.unknown().optional(),
});

const ContractTestResultSchema = z.object({
  schemaParse: z.enum(['PASS', 'FAIL']),
  schemaParseError: z.string().optional(),
  overall: z.enum(['PASS', 'FAIL']),
  findings: z.array(ContractFindingSchema),
});

const JudgeResultSchema = z.object({
  family: z.enum(['lecture', 'meeting', 'interview', 'brainstorm']),
  judgeModelId: z.string(),
  axes: z.record(z.string(), z.number()),
  overall: z.number(),
  issues: z.array(z.string()),
  wins: z.array(z.string()),
});

const ContentFidelitySchema = z.object({
  score: z.number(),
  parroting: z.boolean(),
  evidence: z.array(z.string()),
  judgeModelId: z.string(),
});

const RetryHistogramSchema = z.object({
  samples: z.number().int().nonnegative(),
  attemptsMean: z.number().nonnegative(),
  attemptsByBin: z.record(z.string(), z.number().int().nonnegative()),
});

const SlotDistributionSchema = z.object({
  slotTypes: z.number().int().nonnegative(),
  slotsEmerged: z.number().int().nonnegative(),
  byType: z.record(z.string(), z.number().int().nonnegative()),
});

const FaithfulnessSchema = z.object({
  prepass: z.object({
    jaRatio: z.number(),
    languageFlip: z.boolean(),
    groundingJa: z.number(),
    groundingAscii: z.number(),
  }),
  judge: z.object({
    verdicts: z.array(z.object({
      claim: z.string(),
      verdict: z.enum(['supported', 'unsupported', 'partial']),
      span: z.string(),
    })),
    unsupportedCount: z.number().int().nonnegative(),
    overall: z.enum(['PASS', 'FAIL']),
    judgeModelId: z.string(),
  }).optional(),                                       // optional — skipped when no facts[] or skipLlmJudge
  gate: z.enum(['PASS', 'FAIL']),                      // combined prepass+judge verdict
});

const CoverageSchema = z.object({
  captured: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  ratio: z.number(),
  missing: z.array(z.string()),
});

export const FixtureResultSchema = z.object({
  fixtureId: z.string(),
  family: z.enum(['lecture', 'meeting', 'interview', 'brainstorm']),
  contractTest: ContractTestResultSchema,
  judge: JudgeResultSchema.optional(),                  // optional — ContractTest-only runs skip the LLM
  contentFidelity: ContentFidelitySchema.optional(),    // optional — Lecture-default, others on demand
  retryHistogram: RetryHistogramSchema.optional(),
  slotDistribution: SlotDistributionSchema.optional(),
  faithfulness: FaithfulnessSchema.optional(),         // Phase 1 gate — present when fixture has facts[] or for a flip pre-pass
  coverage: CoverageSchema.optional(),                 // Phase 1 scored coverage
  derScore: z.number().optional(),                     // Plan 4 lift, see Task 24
  runMs: z.number().nonnegative(),
});
export type FixtureResult = z.infer<typeof FixtureResultSchema>;

export const BaselineFileSchema = z.object({
  savedAt: z.string().datetime(),
  modelId: z.string(),                                  // ModelProfile.id
  promptVariantId: z.string(),
  judgeModelId: z.string(),
  notes: z.string().optional(),
  results: z.array(FixtureResultSchema),
});
export type BaselineFile = z.infer<typeof BaselineFileSchema>;
