// desktop/eval/runners/single-fixture.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FixtureMetaSchema, FixtureTranscriptSchema, FixtureGroundTruthSchema, type FixtureGroundTruth } from '../fixtures/_schema';
import { runContractTest } from '../contract/contract-test';
import { LECTURE_RULES } from '../contract/families/lecture';
import { MEETING_RULES } from '../contract/families/meeting';
import { INTERVIEW_RULES } from '../contract/families/interview';
import { BRAINSTORM_RULES } from '../contract/families/brainstorm';
import { judgeNote } from '../judges/llm-judge';
import { judgeContentFidelity } from '../judges/content-fidelity-judge';
import { buildRetryHistogram } from '../metrics/retry-histogram';
import { computeSlotDistribution } from '../metrics/slot-distribution';
import type { FixtureResult } from '../baseline/format';
import type { PipelineRunner } from './pipeline-stub';
import { z } from 'zod';

// Per-family stub Zod schema for Phase 7 plumbing. Plan 2 replaces with real schemas.
const StubSchemas: Record<string, z.ZodType> = {
  lecture: z.object({}).passthrough(),
  meeting: z.object({}).passthrough(),
  interview: z.object({}).passthrough(),
  brainstorm: z.object({}).passthrough(),
};

export async function runSingleFixture(opts: {
  fixtureDir: string;
  runner: PipelineRunner;
  skipLlmJudge?: boolean;
  judgeModelId?: string;
}): Promise<FixtureResult> {
  const meta = FixtureMetaSchema.parse(JSON.parse(readFileSync(join(opts.fixtureDir, 'meta.json'), 'utf8')));
  const transcript = FixtureTranscriptSchema.parse(JSON.parse(readFileSync(join(opts.fixtureDir, 'transcript.json'), 'utf8')));
  let groundTruth: FixtureGroundTruth | undefined;
  try {
    const raw = readFileSync(join(opts.fixtureDir, 'ground-truth.json'), 'utf8');
    groundTruth = FixtureGroundTruthSchema.parse(JSON.parse(raw));
  } catch { /* optional */ }

  const t0 = Date.now();
  const pipelineResult = await opts.runner.run({ meta, transcript });
  const runMs = Date.now() - t0;
  // Inject meta for the Lecture slots-emerge rule
  const noteWithMeta = { ...pipelineResult.note, _meta: { expectedSlots: meta.expectedSlots } };

  const rules = {
    lecture: LECTURE_RULES, meeting: MEETING_RULES, interview: INTERVIEW_RULES, brainstorm: BRAINSTORM_RULES,
  }[meta.family];

  const contractTest = runContractTest({
    family: meta.family,
    schema: StubSchemas[meta.family],
    note: noteWithMeta,
    rules,
    transcript,
    groundTruth,
  });

  const result: FixtureResult = {
    fixtureId: meta.fixtureId,
    family: meta.family,
    contractTest: {
      schemaParse: contractTest.schemaParse,
      schemaParseError: contractTest.schemaParseError,
      overall: contractTest.overall,
      findings: contractTest.findings,
    },
    runMs,
    retryHistogram: buildRetryHistogram(pipelineResult.retryAttempts),
    slotDistribution: meta.family === 'lecture' ? computeSlotDistribution(pipelineResult.note) : undefined,
  };

  if (!opts.skipLlmJudge) {
    result.judge = await judgeNote({ family: meta.family, note: pipelineResult.note, transcript, groundTruth, judgeModelId: opts.judgeModelId });
    if (meta.family === 'lecture') {
      result.contentFidelity = await judgeContentFidelity({ family: 'lecture', note: pipelineResult.note, transcript, groundTruth, judgeModelId: opts.judgeModelId });
    }
  }
  return result;
}
