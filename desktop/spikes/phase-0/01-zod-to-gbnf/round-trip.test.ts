// Spike 0.1 HARD GATE — drive N grammar-constrained LLM completions through
// the converter end-to-end and assert N/N Zod-parse cleanly within retries.
//
// Currently N=5 per Plan Amendment 1 (2026-05-27), originally specified at
// N=10 in the spec; reduced to fit the M3-8GB safe sustained-load envelope
// (`.claude/rules/pitfalls.md (spike-llm)` kernel-panic post-mortem).
// Re-running at N=10 requires the Amendment 1 expiry conditions
// (≥16GB hardware AND founder approval) — see Plan §Spike 0.1 Amendment 1
// + `decision-0.1-fail.md` "Path 2.A/B/C procedures".
//
// Acceptance per Phase-0 plan as amended: <N/N → STOP, do NOT claim
// Spike 0.1 PASS. If this test asserts pass=PROMPTS.length, the on-device
// Lecture v2 path is green-lit to proceed to Spike 0.2 (recipe selection)
// and Spike 0.3 (diarization). Faking the threshold invalidates the verdict.
//
// Retry contract (Path 2 remediation per `decision-0.1-fail.md`, founder
// decision 2026-05-26):
//   - Each sample gets up to 3 attempts total (1 initial + ≤ 2 retries).
//   - Each retry uses a DIFFERENT seed (base 1000 + i, retries +100 × attempt).
//   - Temperature is constant per-sample (0.6, the JSON-mode middle).
//   - A sample PASSES if ANY attempt parses + Zod-validates cleanly.
//
// This matches real grammar-constrained pipelines — vLLM, Outlines, etc. all
// surface a retry/repair layer because grammar-constrained sampling on
// small models occasionally enters two well-known runaway modes:
//   - Mode A (array runaway): unbounded `(elem ("," elem)*)?` rule — model
//     keeps choosing `,` indefinitely.
//   - Mode B (char escape loop): unbounded `char*` rule — model emits
//     `\n\\n\\n…` indefinitely inside an unclosed string.
// See `decision-0.1-fail.md` for full diagnosis from the unbounded-grammar
// iterations 1-3 that landed at 7-8/10 without retries.
//
// Plan 2 (Foundation) implementers MUST plumb a retry budget of ≤ 3
// attempts per grammar-constrained LLM call into the production
// orchestrator. The same failure modes hit production unless the wrapper
// retries on JSON.parse / Zod failure with a fresh seed.
//
// Hydration step (line "kt.from = 'inferred'"): the schema requires `from`
// on every KeyTerm, but `from` is marked `.describe({ postDecodeOnly: true })`
// so the converter (correctly) omits it from the grammar. Production code
// will set `from = 'inferred'` (or 'transcript' via post-decode citation
// matching) in the app layer before Zod-parsing; this test mirrors that
// contract with a literal default. Without this hydration, all 10 samples
// would Zod-fail with "Required" on every key_term.

import { describe, it, expect, afterAll } from 'vitest';
import { writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { zodToGbnf } from './zod-to-gbnf';
import { LectureMiniSchema } from './fixtures/lecture-mini-schema';
import { runLlamaCli } from './llama-cli-rig';

// Safety net per `.claude/rules/pitfalls.md (spike-llm)` rule (added 2026-05-27
// after a session-end kernel panic on M3/8GB). Vitest can be terminated
// mid-run (timeout, Ctrl-C, parent shell exit); any surviving
// `llama-completion` subprocess pins ~3 GB resident and triggers a swap
// thrash on the next session start. afterAll fires even when the suite
// passes; pkill returns non-zero ("no processes matched") in the happy
// case, hence the swallow.
afterAll(() => {
  try {
    execSync('pkill -9 -f llama-completion', { stdio: 'ignore' });
  } catch {
    /* nothing to kill = the happy path */
  }
});

// This spike test runs a real ~6-8 min sequential LLM workload against a
// locally-installed Llama-3.2-3B GGUF and a locally-built llama-completion
// binary. Neither is in the repo or available in CI, so we skip cleanly
// when either prerequisite is missing. The test is meaningful only when
// run on a developer's M-series Mac with the spike artifacts present.
const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../..');
const LLAMA_BIN = resolve(
  REPO_ROOT,
  'desktop/sidecar/deps/llama.cpp/build-spike/bin/llama-completion',
);
const MODEL_PATH =
  process.env.SPIKE_LLM_MODEL_PATH ??
  '/Users/guntak/.lisna-test-models/Llama-3.2-3B-Instruct-Q4_K_M.gguf';
const PREREQS_PRESENT = existsSync(LLAMA_BIN) && existsSync(MODEL_PATH);

// Five distinct topical prompts at one temperature — exercises different
// content rather than the same content 5×. The retry loop varies seed
// per-attempt (not temperature) to keep the experimental design clean:
// we measure model behavior under one sampling setting, with retries as
// a transient-fault recovery mechanism (Path 2 contract).
//
// Trimmed from 10 → 5 (take-4, 2026-05-27) after take-3 hit a kernel
// panic mid-suite on M3/8GB. Kept indices [0..5) from the original list
// because they include Newton's-laws (the most empirically troublesome
// formula-extras case across iters 1-2-3) — a real stress test for the
// retry mechanism while keeping wall-time + RAM-pressure budget cut in
// half.
const PROMPTS: string[] = [
  'Generate a lecture note JSON about photosynthesis with 2 sections, one with formula extras.',
  "Generate a lecture note JSON about Newton's laws of motion with formula extras in the third section.",
  'Generate a lecture note JSON about the Krebs cycle with procedure_steps extras.',
  'Generate a lecture note JSON about supply and demand curves in economics.',
  'Generate a lecture note JSON about the French Revolution with timeline-style sections.',
];

// 5 s sleep between samples gives Metal time to flush per-call kernel
// state and lets the system reclaim transient RSS before the next
// sustained inference. Empirically the M3/8GB ran out of headroom around
// sample 6-8 of the 10-prompt run; 5 s is the smallest delay that's
// noticeably-better-than-zero in `ps -m` between calls.
const INTER_SAMPLE_COOLDOWN_MS = 5000;

// Constant per-sample. 0.6 is the JSON-mode middle — high enough for
// content diversity, low enough to limit (but not eliminate) array/char
// runaway modes. Retries cover the residual failure rate.
const TEMPERATURE = 0.6;
const MAX_TOKENS = 4096;
const MAX_ATTEMPTS = 3;

interface AttemptRecord {
  attempt: number;
  seed: number;
  latencyMs: number;
  ok: boolean;
  reason?: string;
}

interface SampleResult {
  i: number;
  pass: boolean;
  attemptsUsed: number;
  attempts: AttemptRecord[];
  finalReason?: string;
  passingSampleHead?: string;
}

/**
 * Hydrate `from` on every KeyTerm — production contract: post-decode
 * citation matching sets this to 'transcript' or 'inferred'. Test default
 * = 'inferred'. Mutates the input.
 */
function hydratePostDecode(json: unknown): void {
  if (typeof json !== 'object' || json === null) return;
  const obj = json as { sections?: Array<{ key_terms?: Array<{ from?: unknown }> }> };
  for (const section of obj.sections ?? []) {
    for (const kt of section.key_terms ?? []) {
      if (kt.from === undefined) kt.from = 'inferred';
    }
  }
}

/**
 * Parse JSON → hydrate → Zod-validate. Throws on any failure.
 */
function parseAndValidate(text: string): void {
  const json = JSON.parse(text);
  hydratePostDecode(json);
  LectureMiniSchema.parse(json);
}

/**
 * Run a single sample with up to `maxAttempts` retries. Each retry uses a
 * fresh seed (base + 100 × (attempt-1)) at the same temperature. Returns
 * the per-sample record; PASS = any attempt succeeded.
 */
async function runSampleWithRetries(opts: {
  i: number;
  prompt: string;
  grammarPath: string;
  maxTokens: number;
  temperature: number;
  maxAttempts: number;
}): Promise<SampleResult> {
  const attempts: AttemptRecord[] = [];
  const baseSeed = 1000 + opts.i;
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    const seed = baseSeed + (attempt - 1) * 100;
    const t0 = Date.now();
    let ok = false;
    let reason: string | undefined;
    let head: string | undefined;
    try {
      const result = await runLlamaCli({
        prompt: opts.prompt,
        grammarPath: opts.grammarPath,
        maxTokens: opts.maxTokens,
        temperature: opts.temperature,
        seed,
      });
      parseAndValidate(result.text);
      ok = true;
      head = result.text.slice(0, 200);
    } catch (e) {
      reason = e instanceof Error ? e.message : String(e);
    }
    const latencyMs = Date.now() - t0;
    attempts.push({ attempt, seed, latencyMs, ok, reason });
    if (ok) {
      return {
        i: opts.i,
        pass: true,
        attemptsUsed: attempt,
        attempts,
        passingSampleHead: head,
      };
    }
  }
  return {
    i: opts.i,
    pass: false,
    attemptsUsed: opts.maxAttempts,
    attempts,
    finalReason: attempts[attempts.length - 1]?.reason,
  };
}

describe('zod-to-gbnf round trip on LectureMiniSchema (5 samples, retries=3)', () => {
  it.skipIf(!PREREQS_PRESENT)('5/5 LLM samples Zod-parse within ≤3 attempts — HARD GATE', async () => {
    // Use the freshly-regenerated grammar (verifies the converter as it
    // exists right now, not a stale committed snapshot from Task 7).
    const gbnf = zodToGbnf(LectureMiniSchema, 'LectureNote');
    const grammarPath = join(tmpdir(), `lecture-mini-rt-${Date.now()}.gbnf`);
    writeFileSync(grammarPath, gbnf);

    const results: SampleResult[] = [];
    for (let i = 0; i < PROMPTS.length; i++) {
      const r = await runSampleWithRetries({
        i,
        prompt: PROMPTS[i],
        grammarPath,
        maxTokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        maxAttempts: MAX_ATTEMPTS,
      });
      results.push(r);
      console.log(
        `Sample ${i}: ${r.pass ? 'PASS' : 'FAIL'} on attempt ${r.attemptsUsed}/${MAX_ATTEMPTS}` +
          ` (latencies ms: ${r.attempts.map((a) => a.latencyMs).join(', ')})` +
          (r.pass ? '' : ` — ${r.finalReason?.slice(0, 200) ?? 'unknown'}`),
      );
      if (i < PROMPTS.length - 1) {
        await new Promise((r) => setTimeout(r, INTER_SAMPLE_COOLDOWN_MS));
      }
    }

    const passCount = results.filter((r) => r.pass).length;
    const attemptsHistogram = { 1: 0, 2: 0, 3: 0 };
    for (const r of results) {
      if (r.pass) attemptsHistogram[r.attemptsUsed as 1 | 2 | 3]++;
    }
    const allLatencies = results.flatMap((r) => r.attempts.map((a) => a.latencyMs));
    const totalMs = allLatencies.reduce((a, b) => a + b, 0);
    const attemptsArr = results.map((r) => r.attemptsUsed);
    const meanAttempts = attemptsArr.reduce((a, b) => a + b, 0) / attemptsArr.length;
    const p90Attempts = pct(attemptsArr, 90);

    console.log('--- Spike 0.1 retry-loop summary ---');
    console.log(
      `pass=${passCount}/${PROMPTS.length} ` +
        `(attempt 1: ${attemptsHistogram[1]}, ` +
        `attempt 2: ${attemptsHistogram[2]}, ` +
        `attempt 3: ${attemptsHistogram[3]})`,
    );
    console.log(
      `mean attempts/sample = ${meanAttempts.toFixed(2)}, p90 = ${p90Attempts}`,
    );
    console.log(
      `latency ms p50=${median(allLatencies)} p90=${pct(allLatencies, 90)} ` +
        `total=${totalMs}ms (${(totalMs / 1000 / 60).toFixed(2)} min)`,
    );

    const failures = results.filter((r) => !r.pass);
    if (failures.length > 0) {
      console.error(
        'Failures (all 3 attempts exhausted):',
        JSON.stringify(
          failures.map((f) => ({
            i: f.i,
            reasons: f.attempts.map((a) => a.reason?.slice(0, 200)),
          })),
          null,
          2,
        ),
      );
    }

    expect(existsSync(grammarPath)).toBe(true);
    expect(passCount).toBe(PROMPTS.length);
  }, 1_500_000); // 25 min cap. With 5 samples + 5 s cooldowns: pass-on-1
  // averages ~70 s/sample (5 × 70 + 4 × 5 = 370 s ≈ 6 min) and a runaway
  // attempt 1 burns ~480 s (n=4096 saturated) before retry takes ~60 s.
  // Worst case = 2 runaways + 3 pass-on-1: 2 × 540 + 3 × 70 + 4 × 5 =
  // 1310 s ≈ 22 min; 25 min gives ~1.15× headroom. Tighter than the
  // 10-sample 45 min cap because the M3/8GB hardware budget collapses
  // before a full all-runaway case lands — fail fast is safer than
  // pushing through swap thrash. Bump down only after Path 1
  // bounded-grammar shaves the runaway tail; bump up only after empirical
  // measurement shows we need it.
});

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function pct(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const idx = Math.min(s.length - 1, Math.floor((p / 100) * s.length));
  return s[idx];
}
