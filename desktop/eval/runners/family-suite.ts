// desktop/eval/runners/family-suite.ts
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { runSingleFixture } from './single-fixture';
import type { FixtureResult } from '../baseline/format';
import type { PipelineRunner } from './pipeline-stub';
import type { NoteFamily } from '../judges/judge-types';

const GROQ_COOLDOWN_MS = 75_000;                  // same as v1 backend
const NOOP_COOLDOWN_MS = 0;                       // when skipLlmJudge

export async function runFamilySuite(opts: {
  family: NoteFamily;
  runner: PipelineRunner;
  fixturesRoot?: string;
  skipLlmJudge?: boolean;
  judgeModelId?: string;
  fixtureFilter?: string;                          // optional substring filter on fixtureId
  onProgress?: (fixtureId: string, result: FixtureResult, idx: number, total: number) => void;
}): Promise<FixtureResult[]> {
  const root = opts.fixturesRoot ?? 'eval/fixtures';
  const familyRoot = join(root, opts.family);
  const dirs = readdirSync(familyRoot)
    .filter(name => statSync(join(familyRoot, name)).isDirectory())
    .filter(name => !opts.fixtureFilter || name.includes(opts.fixtureFilter))
    .map(name => join(familyRoot, name));
  const results: FixtureResult[] = [];
  const cooldownMs = opts.skipLlmJudge ? NOOP_COOLDOWN_MS : GROQ_COOLDOWN_MS;
  for (let i = 0; i < dirs.length; i++) {
    const fixtureDir = dirs[i];
    const result = await runSingleFixture({
      fixtureDir,
      runner: opts.runner,
      skipLlmJudge: opts.skipLlmJudge,
      judgeModelId: opts.judgeModelId,
    });
    results.push(result);
    opts.onProgress?.(result.fixtureId, result, i + 1, dirs.length);
    if (i < dirs.length - 1 && cooldownMs > 0) {
      await new Promise(r => setTimeout(r, cooldownMs));
    }
  }
  return results;
}
