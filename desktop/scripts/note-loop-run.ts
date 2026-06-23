// FOREGROUND ONLY — spawns the real on-device Llama (pitfalls.md spike-llm).
// NEVER run_in_background. Research instrument for the note-quality loop.
// Runs ONE fixture through the real offline pipeline, CAPTURES the generated
// note (so structure/design can be inspected), and re-scores it with the same
// deterministic (no-LLM) scorers the harness uses. Dumps note + scorecard to
// /tmp/lisna-note-eval/runs/<label>/.
//
// Usage:
//   LISNA_LLM_MODEL_DIR="$HOME/.lisna-test-models" \
//     pnpm --filter @lisna/desktop exec tsx scripts/note-loop-run.ts <absFixtureDir> <label> [runnerId]
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { FixtureMetaSchema, FixtureTranscriptSchema, FixtureGroundTruthSchema, type FixtureGroundTruth } from '../eval/fixtures/_schema';
import { runContractTest } from '../eval/contract/contract-test';
import { LECTURE_RULES } from '../eval/contract/families/lecture';
import { MEETING_RULES } from '../eval/contract/families/meeting';
import { INTERVIEW_RULES } from '../eval/contract/families/interview';
import { BRAINSTORM_RULES } from '../eval/contract/families/brainstorm';
import { faithfulnessPrepass } from '../eval/faithfulness-prepass';
import { computeCoverage } from '../eval/coverage';
import { __testOnly_resolveRunner } from './eval-notes';

const StubSchemas: Record<string, z.ZodType> = {
  lecture: z.object({}).passthrough(), meeting: z.object({}).passthrough(),
  interview: z.object({}).passthrough(), brainstorm: z.object({}).passthrough(),
};
const RULES: Record<string, unknown> = {
  lecture: LECTURE_RULES, meeting: MEETING_RULES, interview: INTERVIEW_RULES, brainstorm: BRAINSTORM_RULES,
};

async function main(): Promise<void> {
  const fixtureDir = process.argv[2];
  const label = process.argv[3];
  const runnerId = process.argv[4] ?? 'offline-3b';
  if (!fixtureDir || !label) { console.error('args: <absFixtureDir> <label> [runnerId]'); process.exit(1); }

  const meta = FixtureMetaSchema.parse(JSON.parse(readFileSync(join(fixtureDir, 'meta.json'), 'utf8')));
  const transcript = FixtureTranscriptSchema.parse(JSON.parse(readFileSync(join(fixtureDir, 'transcript.json'), 'utf8')));
  let groundTruth: FixtureGroundTruth | undefined;
  try { groundTruth = FixtureGroundTruthSchema.parse(JSON.parse(readFileSync(join(fixtureDir, 'ground-truth.json'), 'utf8'))); } catch { /* optional */ }

  const runner = await __testOnly_resolveRunner(runnerId);
  const t0 = Date.now();
  const pr = await runner.run({ meta, transcript }) as { note: Record<string, unknown>; retryAttempts?: number[] };
  const runMs = Date.now() - t0;

  const note = pr.note;
  const noteWithMeta = { ...note, _meta: { expectedSlots: meta.expectedSlots } };
  const ct = runContractTest({ family: meta.family, schema: StubSchemas[meta.family], note: noteWithMeta, rules: RULES[meta.family] as never, transcript, groundTruth });
  const transcriptText = transcript.transcripts.map(b => b.text).join('');
  const prepass = faithfulnessPrepass(note as never, transcriptText);
  const coverage = computeCoverage(meta.family, note as never, groundTruth);

  const outDir = join('/tmp/lisna-note-eval/runs', label);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'note.json'), JSON.stringify(note, null, 2));
  const scorecard = { label, runnerId, fixtureId: meta.fixtureId, family: meta.family, runMs, retryAttempts: pr.retryAttempts, contractTest: ct, coverage, faithfulnessPrepass: prepass };
  writeFileSync(join(outDir, 'scorecard.json'), JSON.stringify(scorecard, null, 2));

  console.log('=== LABEL', label, '| runner', runnerId, '| runMs', runMs, '===');
  console.log('note      →', join(outDir, 'note.json'));
  console.log('scorecard →', join(outDir, 'scorecard.json'));
  console.log('contract.overall:', JSON.stringify(ct.overall ?? (ct as Record<string, unknown>)['verdict']));
  console.log('coverage:', JSON.stringify(coverage));
  console.log('prepass:', JSON.stringify(prepass));
}

main().catch((e) => { console.error(e); process.exit(1); });
