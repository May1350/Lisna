import { fileURLToPath } from 'node:url';
import { join, resolve, dirname } from 'node:path';
import { runFamilySuite } from '../eval/runners/family-suite';
import { runRegression } from '../eval/runners/regression';
import { saveBaseline } from '../eval/baseline/store';
import { formatScorecard } from '../eval/scorecard';
import { STUB_RUNNER } from '../eval/runners/pipeline-stub';
import { makeOfflineRunner } from '../eval/runners/offline';
import { modelProfiles } from '../src/shared/models/profiles';
import type { NoteFamily } from '../eval/judges/judge-types';
import type { PipelineRunner } from '../eval/runners/pipeline-stub';

interface CliArgs {
  family: NoteFamily;
  fixtureFilter?: string;
  runnerId: 'stub' | 'offline-3b' | 'offline-1b';
  saveAs?: string;
  against?: string;
  judgeModelId?: string;
  skipLlmJudge: boolean;
  dryRun: boolean;
}

export function __testOnly_parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { family: 'lecture', runnerId: 'stub', skipLlmJudge: false, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--family') out.family = argv[++i] as NoteFamily;
    else if (a === '--fixture') out.fixtureFilter = argv[++i];
    else if (a === '--runner') out.runnerId = argv[++i] as CliArgs['runnerId'];
    else if (a === '--baseline') out.saveAs = argv[++i];
    else if (a === '--against') out.against = argv[++i];
    else if (a === '--judge') out.judgeModelId = argv[++i];
    else if (a === '--no-llm-judge') out.skipLlmJudge = true;
    else if (a === '--dry-run') out.dryRun = true;
  }
  return out;
}

// Runner id → the ModelProfile it loads. The offline runner re-derives modelId
// from the model filename, so this map only chooses WHICH model file to load.
const OFFLINE_MODEL_ID: Record<string, string> = {
  'offline-3b': 'llama-3.2-3b-q4-km',
  'offline-1b': 'llama-3.2-1b-q4-km',
};

export async function __testOnly_resolveRunner(
  id: string,
  cfg: { modelDir?: string; sidecarBin?: string } = {},
): Promise<PipelineRunner> {
  if (id === 'stub') return STUB_RUNNER;
  const modelId = OFFLINE_MODEL_ID[id];
  if (modelId) {
    const modelDir = cfg.modelDir ?? process.env.LISNA_LLM_MODEL_DIR;
    if (!modelDir) throw new Error(`set LISNA_LLM_MODEL_DIR (or pass cfg.modelDir) to use runner '${id}'`);
    const sidecarBin = cfg.sidecarBin ?? process.env.LISNA_SIDECAR_BIN
      ?? resolve(dirname(fileURLToPath(import.meta.url)), '../resources/sidecar');
    const profile = modelProfiles[modelId];
    if (!profile) throw new Error(`no model profile '${modelId}' for runner '${id}'`);
    const llmModelPath = join(modelDir, profile.filename);
    return makeOfflineRunner({ runnerId: id, sidecarBin, llmModelPath });
  }
  throw new Error(`unknown runner '${id}'`);
}

async function resolveRunner(id: string): Promise<PipelineRunner> {
  return __testOnly_resolveRunner(id);
}

async function main(): Promise<void> {
  const opts = __testOnly_parseArgs(process.argv);
  if (opts.dryRun) {
    console.log('[dry-run] would invoke:', JSON.stringify(opts, null, 2));
    return;
  }
  const runner = await resolveRunner(opts.runnerId);
  const BASELINE_DIR = 'eval/baselines';
  if (opts.against) {
    const againstPath = join(BASELINE_DIR, `${opts.against}.json`);
    const reg = await runRegression({
      family: opts.family,
      runner,
      againstBaselinePath: againstPath,
      saveAsPath: opts.saveAs ? join(BASELINE_DIR, `${opts.saveAs}.json`) : undefined,
      skipLlmJudge: opts.skipLlmJudge,
      judgeModelId: opts.judgeModelId,
    });
    console.log(formatScorecard(reg.after.results, reg.diff));
    if (reg.diff.summary.regression) {
      console.error('REGRESSION — exiting non-zero');
      process.exitCode = 2;
    }
    return;
  }
  const results = await runFamilySuite({
    family: opts.family,
    runner,
    skipLlmJudge: opts.skipLlmJudge,
    judgeModelId: opts.judgeModelId,
    fixtureFilter: opts.fixtureFilter,
    onProgress: (id, _, idx, total) => console.log(`  [${idx}/${total}] ${id} ... done`),
  });
  console.log(formatScorecard(results));
  if (opts.saveAs) {
    saveBaseline(join(BASELINE_DIR, `${opts.saveAs}.json`), {
      savedAt: new Date().toISOString(),
      modelId: runner.modelId,
      promptVariantId: runner.promptVariantId,
      judgeModelId: opts.judgeModelId ?? 'llama-3.3-70b-versatile',
      results,
    });
    console.log(`baseline saved → ${BASELINE_DIR}/${opts.saveAs}.json`);
  }
}

// Only auto-run when invoked directly (not when imported by tests).
// In ESM + tsx, import.meta.url matches the resolved process.argv[1] path
// when this file is the entry point; when imported as a module they differ.
const _isMain = fileURLToPath(import.meta.url) === process.argv[1];
if (_isMain) {
  main().catch(e => { console.error(e); process.exit(1); });
}
