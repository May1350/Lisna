// Spike 0.2 runner — one invocation per process, controlled by
// SPIKE_RUN_INDEX env var. Loops live in the shell driver below
// (3 runs × 5s cooldown). See README scorecard for acceptance.
//
// Why one-invocation-per-process: matches the Spike 0.1 pitfall guard
// (`spike-llm` rule, 2026-05-27). Each runner spawns `llama-completion`
// in foreground, awaits close, writes one result JSON, exits. The shell
// driver imposes the cooldown between processes so transient RSS has
// time to drain on M3/8GB.
//
// Hydration: like Spike 0.1, `key_terms[].from` is post-decode (marked
// with `postDecodeOnly: true` description on the schema). We set
// `from = 'inferred'` on every key_term before Zod.parse to mirror the
// production contract.

import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { runLlamaCli } from '../01-zod-to-gbnf/llama-cli-rig';
import { zodToGbnf } from '../01-zod-to-gbnf/zod-to-gbnf';
import { LectureMiniSchema } from '../01-zod-to-gbnf/fixtures/lecture-mini-schema';
import { buildLectureSpikePrompt, type TranscriptBucket } from './lecture-prompt';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(HERE, 'fixture-transcript.json');
const RESULTS_DIR = resolve(HERE, 'results');
const RUN_INDEX = Number(process.env.SPIKE_RUN_INDEX ?? '0');

// 13_000 chars ≈ 8K tokens for JA dense text (1.6 char/tok upper bound).
// Above this, n_ctx=16K headroom shrinks below the 4K generation budget.
const TRANSCRIPT_CHAR_BUDGET = 13_000;
const MAX_TOKENS = 4096;
const TEMPERATURE = 0.4;
const BASE_SEED = 2000;

interface RunResult {
  runIndex: number;
  seed: number;
  elapsedMs: number;
  outputBytes: number;
  validation: 'PASS' | 'FAIL';
  slotsEmerged: number;
  sections: number;
  sample: unknown | null;
  failureReason?: string;
  stderrTail?: string;
}

function hydratePostDecode(json: unknown): void {
  if (typeof json !== 'object' || json === null) return;
  const obj = json as { sections?: Array<{ key_terms?: Array<{ from?: unknown }> }> };
  for (const section of obj.sections ?? []) {
    for (const kt of section.key_terms ?? []) {
      if (kt.from === undefined) kt.from = 'inferred';
    }
  }
}

function sliceTranscript(buckets: TranscriptBucket[], charBudget: number): TranscriptBucket[] {
  let total = 0;
  const out: TranscriptBucket[] = [];
  for (const b of buckets) {
    const lineLen = b.text.length + 10; // ~10 chars of formatting overhead per line
    if (total + lineLen > charBudget) break;
    out.push(b);
    total += lineLen;
  }
  return out;
}

async function main(): Promise<void> {
  mkdirSync(RESULTS_DIR, { recursive: true });

  // Load + slice fixture
  const buckets = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as TranscriptBucket[];
  const sliced = sliceTranscript(buckets, TRANSCRIPT_CHAR_BUDGET);
  const slicedChars = sliced.reduce((acc, b) => acc + b.text.length, 0);

  // Regenerate grammar from current LectureMiniSchema (verifies the
  // converter as it exists right now, not a stale committed snapshot).
  const gbnf = zodToGbnf(LectureMiniSchema, 'LectureNote');
  const grammarPath = resolve(tmpdir(), `lecture-spike-${Date.now()}-${RUN_INDEX}.gbnf`);
  writeFileSync(grammarPath, gbnf);

  const prompt = buildLectureSpikePrompt(sliced);
  const seed = BASE_SEED + RUN_INDEX;

  console.log(
    `Run ${RUN_INDEX}: ${sliced.length} buckets / ${slicedChars} chars transcript, ` +
      `${prompt.length} chars prompt, seed=${seed}`,
  );

  let result: RunResult;
  try {
    const llamaResult = await runLlamaCli({
      prompt,
      grammarPath,
      maxTokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      seed,
    });

    let parsed: unknown = null;
    let validation: 'PASS' | 'FAIL' = 'FAIL';
    let failureReason: string | undefined;
    let slotsEmerged = 0;
    let sections = 0;

    try {
      const json = JSON.parse(llamaResult.text);
      hydratePostDecode(json);
      parsed = LectureMiniSchema.parse(json);
      validation = 'PASS';
      const lecture = parsed as { sections: Array<{ extras?: unknown[] }> };
      sections = lecture.sections.length;
      slotsEmerged = lecture.sections.reduce(
        (acc, sec) => acc + (sec.extras?.length ?? 0),
        0,
      );
    } catch (e) {
      failureReason = e instanceof Error ? e.message : String(e);
    }

    result = {
      runIndex: RUN_INDEX,
      seed,
      elapsedMs: llamaResult.elapsedMs,
      outputBytes: Buffer.byteLength(llamaResult.text, 'utf8'),
      validation,
      slotsEmerged,
      sections,
      sample: parsed,
      failureReason,
      stderrTail: llamaResult.stderrTail, // Spike 0.2 Path E: keep full rig buffer (4KB) — llama.cpp perf-timing block lives above memory-breakdown footer.
    };
  } catch (e) {
    result = {
      runIndex: RUN_INDEX,
      seed,
      elapsedMs: -1,
      outputBytes: 0,
      validation: 'FAIL',
      slotsEmerged: 0,
      sections: 0,
      sample: null,
      failureReason: `spawn-or-runtime: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = resolve(RESULTS_DIR, `run-${ts}-i${RUN_INDEX}.json`);
  writeFileSync(outPath, JSON.stringify(result, null, 2));

  // One-line console summary — no full sample dump (could be 4 KB JSON)
  console.log(
    `Result: { elapsedMs: ${result.elapsedMs}, validation: '${result.validation}', ` +
      `slotsEmerged: ${result.slotsEmerged}, sections: ${result.sections}, ` +
      `outputBytes: ${result.outputBytes} }`,
  );
  if (result.failureReason) {
    console.log(`failureReason: ${result.failureReason.slice(0, 300)}`);
  }
}

main().catch((e) => {
  console.error('Run failed:', e);
  process.exit(1);
});
