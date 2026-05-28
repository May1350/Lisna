// desktop/scripts/eval-judge-swap.ts
//
// Runs the same family suite against multiple judges and prints a
// matrix of mean overall + per-fixture variance. Use to assess judge
// calibration drift before committing a baseline change.
//
// Example: pnpm --filter @lisna/desktop eval:judge-swap \
//   --family lecture --fixture procedural-physics-em \
//   --judges llama-3.3-70b-versatile,claude-opus-4-x,llama-3.1-8b-instant

import { runFamilySuite } from '../eval/runners/family-suite';
import { STUB_RUNNER } from '../eval/runners/pipeline-stub';
import type { NoteFamily } from '../eval/judges/judge-types';
import { fileURLToPath } from 'node:url';

interface Args {
  family: NoteFamily;
  fixtureFilter?: string;
  judges: string[];
}

function parseArgs(argv: string[]): Args {
  const out: Args = { family: 'lecture', judges: ['llama-3.3-70b-versatile'] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--family') out.family = argv[++i] as NoteFamily;
    else if (a === '--fixture') out.fixtureFilter = argv[++i];
    else if (a === '--judges') out.judges = argv[++i]!.split(',').map(s => s.trim());
  }
  return out;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);
  console.log(`Judge-swap matrix on family=${opts.family} fixture=${opts.fixtureFilter ?? '*'}`);
  const matrix: Record<string, Record<string, number>> = {};
  for (const judge of opts.judges) {
    console.log(`\n  judge: ${judge}`);
    const results = await runFamilySuite({
      family: opts.family,
      runner: STUB_RUNNER,
      judgeModelId: judge,
      fixtureFilter: opts.fixtureFilter,
    });
    for (const r of results) {
      matrix[r.fixtureId] ??= {};
      matrix[r.fixtureId]![judge] = r.judge?.overall ?? 0;
    }
  }
  // Print matrix
  console.log('\n  Matrix (overall scores):');
  const fixtures = Object.keys(matrix);
  const header = ['fixtureId'.padEnd(30), ...opts.judges.map(j => j.padEnd(28))].join(' ');
  console.log('  ' + header);
  for (const f of fixtures) {
    const row = [f.padEnd(30), ...opts.judges.map(j => (matrix[f]?.[j] ?? 0).toFixed(2).padEnd(28))].join(' ');
    console.log('  ' + row);
  }
  // Per-fixture variance
  console.log('\n  Per-fixture cross-judge variance (max - min):');
  for (const f of fixtures) {
    const vals = opts.judges.map(j => matrix[f]?.[j] ?? 0);
    const spread = Math.max(...vals) - Math.min(...vals);
    console.log(`    ${f.padEnd(30)} spread = ${spread.toFixed(2)}${spread > 1.5 ? ' ⚠ HIGH' : ''}`);
  }
}

// Only run when invoked directly, not when imported by tests.
// In ESM + tsx, import.meta.url matches the resolved process.argv[1] path
// when this file is the entry point; when imported as a module they differ.
const _isMain = fileURLToPath(import.meta.url) === process.argv[1];
if (_isMain) {
  main().catch(e => { console.error(e); process.exit(1); });
}
