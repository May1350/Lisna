// desktop/scripts/score-spike-0.2.ts
//
// Score Spike 0.2 3B Lecture results against the Plan 7 harness as the
// v0 baseline. Spike 0.2 already produced result JSONs under
// desktop/spikes/phase-0/02-3b-lecture-grammar/results/. This script:
//   1. Reads each result JSON
//   2. Wraps as a synthetic PipelineRunner that just returns the result
//   3. Runs through runSingleFixture (ContractTest + LLM judge + content-fidelity)
//   4. Saves the aggregated baseline file
//
// HARDWARE-SAFETY: no sidecar invocation — pure file I/O + Groq API calls.
//
// Run: pnpm --filter @lisna/desktop eval:spike-0.2

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { runSingleFixture } from '../eval/runners/single-fixture';
import { saveBaseline } from '../eval/baseline/store';
import { formatScorecard } from '../eval/scorecard';
import type { PipelineRunner } from '../eval/runners/pipeline-stub';
import type { FixtureResult, BaselineFile } from '../eval/baseline/format';
import { fileURLToPath } from 'node:url';

const SPIKE_RESULTS_DIR = 'spikes/phase-0/02-3b-lecture-grammar/results';
const FIXTURE_DIR = 'eval/fixtures/lecture/procedural-physics-em';
const OUT_PATH = 'eval/baselines/v0-spike-0.2-lecture.json';

function listSpikeResults(): { path: string; runIndex: number }[] {
  if (!existsSync(SPIKE_RESULTS_DIR)) {
    throw new Error(`Spike 0.2 results not found at ${SPIKE_RESULTS_DIR} — run the spike first`);
  }
  return readdirSync(SPIKE_RESULTS_DIR)
    .filter(f => f.startsWith('run-') && f.endsWith('.json'))
    .map(f => {
      const m = f.match(/-i(\d+)\.json$/);
      return { path: join(SPIKE_RESULTS_DIR, f), runIndex: m ? Number(m[1]) : 0 };
    })
    .sort((a, b) => a.runIndex - b.runIndex);
}

function makeReplayRunner(spikeResultPath: string): PipelineRunner {
  const data = JSON.parse(readFileSync(spikeResultPath, 'utf8')) as {
    runIndex: number;
    elapsedMs: number;
    sample: unknown;
    validation: 'PASS' | 'FAIL';
  };
  return {
    id: `replay-spike-0.2-i${data.runIndex}`,
    modelId: 'llama-3.2-3b-q4-km',
    promptVariantId: 'spike-0.2-baseline',
    async run() {
      // Hydrate post-decode `from: 'inferred'` like spike 0.2's run-spike does
      const note: any = JSON.parse(JSON.stringify(data.sample ?? {}));
      for (const section of note.sections ?? []) {
        for (const kt of section.key_terms ?? []) {
          if (kt.from === undefined) kt.from = 'inferred';
        }
      }
      return { note, retryAttempts: [1], runMs: data.elapsedMs };
    },
  };
}

async function main(): Promise<void> {
  const spikes = listSpikeResults();
  console.log(`Found ${spikes.length} Spike 0.2 results — scoring against ${FIXTURE_DIR}`);
  const results: FixtureResult[] = [];
  for (let i = 0; i < spikes.length; i++) {
    const s = spikes[i]!;
    console.log(`\n  scoring ${s.path} ...`);
    const runner = makeReplayRunner(s.path);
    const result = await runSingleFixture({ fixtureDir: FIXTURE_DIR, runner });
    // Give each run a unique fixtureId so the scorecard shows them all
    result.fixtureId = `procedural-physics-em@i${s.runIndex}`;
    results.push(result);
    // 75s cooldown between Groq judge calls (skip after last)
    if (i < spikes.length - 1) {
      console.log('    cooling down 75s for Groq TPM...');
      await new Promise(r => setTimeout(r, 75_000));
    }
  }
  const baseline: BaselineFile = {
    savedAt: new Date().toISOString(),
    modelId: 'llama-3.2-3b-q4-km',
    promptVariantId: 'spike-0.2-baseline',
    judgeModelId: 'llama-3.3-70b-versatile',
    notes: 'v0 baseline lifted from Spike 0.2 results — first real-data run of Plan 7 harness',
    results,
  };
  saveBaseline(OUT_PATH, baseline);
  console.log(formatScorecard(results));
  console.log(`\nv0 baseline saved → ${OUT_PATH}`);
}

// Only run when invoked directly, not when imported by tests.
const _isMain = fileURLToPath(import.meta.url) === process.argv[1];
if (_isMain) {
  main().catch(e => { console.error(e); process.exit(1); });
}
