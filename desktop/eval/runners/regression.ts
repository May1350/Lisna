// desktop/eval/runners/regression.ts
import { runFamilySuite } from './family-suite';
import { loadBaseline, saveBaseline } from '../baseline/store';
import { diffBaselines } from '../baseline/diff';
import type { BaselineFile } from '../baseline/format';
import type { PipelineRunner } from './pipeline-stub';
import type { NoteFamily } from '../judges/judge-types';
import type { BaselineDiff } from '../baseline/diff';

export interface RegressionRun {
  before: BaselineFile;
  after: BaselineFile;
  diff: BaselineDiff;
}

export async function runRegression(opts: {
  family: NoteFamily;
  runner: PipelineRunner;
  againstBaselinePath: string;
  saveAsPath?: string;
  skipLlmJudge?: boolean;
  judgeModelId?: string;
  notes?: string;
}): Promise<RegressionRun> {
  const before = loadBaseline(opts.againstBaselinePath);
  if (!before) throw new Error(`baseline not found: ${opts.againstBaselinePath}`);
  const results = await runFamilySuite({
    family: opts.family,
    runner: opts.runner,
    skipLlmJudge: opts.skipLlmJudge,
    judgeModelId: opts.judgeModelId,
  });
  const after: BaselineFile = {
    savedAt: new Date().toISOString(),
    modelId: opts.runner.modelId,
    promptVariantId: opts.runner.promptVariantId,
    judgeModelId: opts.judgeModelId ?? before.judgeModelId,
    notes: opts.notes,
    results,
  };
  if (opts.saveAsPath) saveBaseline(opts.saveAsPath, after);
  const diff = diffBaselines(before, after);
  return { before, after, diff };
}
