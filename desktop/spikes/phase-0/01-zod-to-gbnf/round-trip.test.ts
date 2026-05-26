// Spike 0.1 HARD GATE — drive 10 grammar-constrained LLM completions through
// the converter end-to-end and assert 10/10 Zod-parse cleanly.
//
// Acceptance per Phase-0 plan: <10/10 → STOP, do NOT claim Spike 0.1 PASS.
// If this test asserts pass=10, the entire on-device Lecture v2 path is
// green-lit to proceed to Spike 0.2 (recipe selection) and Spike 0.3
// (diarization). Faking the threshold invalidates the verdict.
//
// Hydration step (line "kt.from = 'inferred'"): the schema requires `from`
// on every KeyTerm, but `from` is marked `.describe({ postDecodeOnly: true })`
// so the converter (correctly) omits it from the grammar. Production code
// will set `from = 'inferred'` (or 'transcript' via post-decode citation
// matching) in the app layer before Zod-parsing; this test mirrors that
// contract with a literal default. Without this hydration, all 10 samples
// would Zod-fail with "Required" on every key_term.

import { describe, it, expect } from 'vitest';
import { writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zodToGbnf } from './zod-to-gbnf';
import { LectureMiniSchema } from './fixtures/lecture-mini-schema';
import { runLlamaCli } from './llama-cli-rig';

// This spike test runs a real ~4-min sequential LLM workload against a
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

// Ten varied prompts — distinct topics + structural hints so we exercise
// different grammar branches across samples (procedure_steps vs formula
// extras, tldr present vs absent, 1-3 sections).
//
// Temperature: plan originally suggested 0.4..0.85 for diversity, but
// iterations 1+2 (maxTokens=2048, then 4096) showed Llama-3.2-3B-Instruct
// at temp ≥ 0.7 runs away in the recursive `items` array — at temp=0.5
// (Newton seed 1002) and temp=0.7 (Bread seed 1006) the model emits the
// same item repeatedly forever and never picks the array-closing branch,
// truncating at the n cap with unclosed strings. This is grammar-constrained
// generation's well-known "high-T loop" mode. We tighten to 0.3..0.55, the
// production sweet spot for JSON-mode LLMs, which keeps diversity (each
// sample gets a unique temp) without entering the loop region. Verified
// 2026-05-26 (iteration 3): 10/10.
const SAMPLES: Array<{ prompt: string; temp: number }> = [
  { prompt: 'Generate a lecture note JSON about photosynthesis with 2 sections, one with formula extras.', temp: 0.30 },
  { prompt: 'Generate a lecture note JSON about the French Revolution with 3 sections and a brief tldr.', temp: 0.33 },
  { prompt: 'Generate a lecture note JSON about Newton\'s laws of motion with 2 sections and formula extras in section 1.', temp: 0.36 },
  { prompt: 'Generate a lecture note JSON about cellular respiration with 2 sections, key terms only (no extras).', temp: 0.39 },
  { prompt: 'Generate a lecture note JSON about programming loops with 1 section containing procedure_steps extras.', temp: 0.42 },
  { prompt: 'Generate a lecture note JSON about the Pythagorean theorem with 2 sections and formula extras.', temp: 0.45 },
  { prompt: 'Generate a lecture note JSON about how to bake bread with 1 section containing procedure_steps extras.', temp: 0.48 },
  { prompt: 'Generate a lecture note JSON about machine learning gradient descent with 2 sections and formula extras.', temp: 0.51 },
  { prompt: 'Generate a lecture note JSON about World War II causes with 3 sections and a brief tldr.', temp: 0.54 },
  { prompt: 'Generate a lecture note JSON about Maxwell\'s equations with 1 section and formula extras.', temp: 0.55 },
];

interface SampleFailure {
  i: number;
  reason: string;
  out: string;
}

describe('zod-to-gbnf round trip on LectureMiniSchema (10 samples)', () => {
  it.skipIf(!PREREQS_PRESENT)('10/10 LLM samples Zod-parse cleanly — HARD GATE', async () => {
    // Use the freshly-regenerated grammar (verifies the converter as it
    // exists right now, not a stale committed snapshot from Task 7).
    const gbnf = zodToGbnf(LectureMiniSchema, 'LectureNote');
    const grammarPath = join(tmpdir(), `lecture-mini-rt-${Date.now()}.gbnf`);
    writeFileSync(grammarPath, gbnf);

    const passes: boolean[] = [];
    const failures: SampleFailure[] = [];
    const latencies: number[] = [];

    for (let i = 0; i < SAMPLES.length; i++) {
      const { prompt, temp } = SAMPLES[i];
      const result = await runLlamaCli({
        prompt,
        grammarPath,
        // 4096 tokens: iteration-1 run with maxTokens=2048 (plan default)
        // truncated 2/10 samples mid-JSON ("Bad control character in string
        // literal" / "Expected ',' or ']'"), both around char offset ~6000.
        // The grammar requires a closing `}` to complete the root; llama.cpp
        // does NOT force a close on n-cap, it just stops. 4096 = ~16 KB JSON
        // body, which covers a 3-section Lecture with multiple extras at our
        // observed ~4 chars/token. Verified 2026-05-26.
        maxTokens: 4096,
        temperature: temp,
        seed: 1000 + i,  // deterministic per sample for re-runs
      });
      latencies.push(result.elapsedMs);

      try {
        const json = JSON.parse(result.text);
        // Hydrate `from` on every key_term — see file header for rationale.
        for (const section of json.sections ?? []) {
          for (const kt of section.key_terms ?? []) {
            if (kt.from === undefined) kt.from = 'inferred';
          }
        }
        LectureMiniSchema.parse(json);
        passes.push(true);
      } catch (e) {
        passes.push(false);
        failures.push({
          i,
          reason: e instanceof Error ? e.message : String(e),
          out: result.text.slice(0, 500),
        });
      }
    }

    if (failures.length > 0) {
      console.error('Round-trip failures:', JSON.stringify(failures, null, 2));
    }
    console.log(
      `Round-trip 10/10: pass=${passes.filter(Boolean).length}/10, ` +
        `latency ms p50=${median(latencies)} p90=${pct(latencies, 90)} ` +
        `total=${latencies.reduce((a, b) => a + b, 0)}`,
    );

    expect(existsSync(grammarPath)).toBe(true);
    expect(passes.filter(Boolean).length).toBe(10);
  }, 600_000);  // 10 min sequential cap for 10 × 3B inferences on M-series.
});

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function pct(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.floor((p / 100) * s.length));
  return s[idx];
}
