/**
 * Decode-speed A/B: grammar-constrained vs unconstrained generation.
 *
 * Discriminates the 1-min-target decision tree's "decode too slow" branch
 * (founder run 2026-06-10 19:30: 591 tokens @ 6.8 tok/s, < 12 threshold):
 * is the slowness the grammar mask (and specifically the Path G bounded
 * grammar), or the machine/model itself?
 *
 * Arms (same prompt, seed, temperature, maxTokens; order detects drift):
 *   warmup  — 16-token plain generate (Metal cold-cache first-run guard,
 *             memory: project_metal_cold_cache_first_run)
 *   plain   — no grammar
 *   mini    — spike-era simple grammar (pre-Path-G, no cascading rules)
 *   full    — production zodToGbnf(LectureNoteSchema) with Path G bounds
 *
 * tok/s is reported two ways: raw tokensOut/genMs (matches production
 * tokPerSec telemetry) and post-TTFT (excludes prefill) so the prefill
 * share can't blur the decode-rate comparison.
 *
 * Run: cd desktop && pnpm tsx scripts/grammar-ab.ts
 * FOREGROUND ONLY — spawns real LLM inference (pitfalls.md spike-llm).
 */
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SidecarClient } from '../src/main/sidecar/client';
import { LlamaCppLLM } from '../src/main/engines/llama-cpp-llm';
import { TIMEOUTS } from '../src/main/sidecar/timeouts';
import { zodToGbnf } from '../src/shared/note-schema/zod-to-gbnf';
import { LectureNoteSchema } from '../src/shared/families/lecture/schema';
import { lecturePromptsV1 } from '../src/shared/families/lecture/prompts/v1';
import { renderSystemTemplate } from '../src/shared/families/util/prompts';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SIDECAR_BIN = resolve(__dirname, '../resources/sidecar');
const MODEL_PATH =
  process.env.LISNA_TEST_LLM_MODEL ??
  resolve(process.env.HOME!, '.lisna-test-models/Llama-3.2-3B-Instruct-Q4_K_M.gguf');
const FIXTURE = resolve(__dirname, '../eval/fixtures/lecture/smoke-ja-mini/transcript.json');
const MINI_GRAMMAR = resolve(__dirname, '../spikes/phase-0/01-zod-to-gbnf/lecture-mini.gbnf');

const SEED = 7000; // matches founder-run base seed
const TEMPERATURE = 0.4;
const MAX_TOKENS = 3000;

interface ArmResult {
  arm: string;
  tokensOut?: number;
  genMs?: number;
  ttftMs: number;
  wallMs: number;
  rawTokPerSec?: number; // tokensOut / genMs — matches production tokPerSec
  decodeTokPerSec?: number; // tokensOut / (wall - ttft) — prefill excluded
  textHead: string;
}

function formatTs(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function buildPrompt(): string {
  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
    transcripts: Array<{ ts: number; text: string }>;
  };
  const transcript = fixture.transcripts.map((s) => `[${formatTs(s.ts)}] ${s.text}`).join('\n');
  const userPrompt = lecturePromptsV1.chunkUserTemplate({ chunkIndex: 0, totalChunks: 1, transcript });
  return `${renderSystemTemplate(lecturePromptsV1.systemTemplate, 'ja')}\n\n${userPrompt}`;
}

async function runArm(
  client: SidecarClient,
  arm: string,
  prompt: string,
  grammar: string | undefined,
  maxTokens: number,
): Promise<ArmResult> {
  let text = '';
  let stats: { tokensOut: number; genMs: number } | undefined;
  const t0 = Date.now();
  let tFirst = 0;
  for await (const tok of client.sendStream(
    {
      type: 'generate',
      messages: [{ role: 'user', content: prompt }],
      ...(grammar ? { grammar } : {}),
      seed: SEED,
      temperature: TEMPERATURE,
      maxTokens,
    },
    { timeoutMs: TIMEOUTS.GENERATE_NO_PROGRESS_MS, onDone: (s) => { stats = s; } },
  )) {
    if (!tFirst) tFirst = Date.now();
    text += tok;
  }
  const wallMs = Date.now() - t0;
  const ttftMs = tFirst ? tFirst - t0 : wallMs;
  const decodeMs = wallMs - ttftMs;
  const r: ArmResult = {
    arm,
    tokensOut: stats?.tokensOut,
    genMs: stats?.genMs,
    ttftMs,
    wallMs,
    rawTokPerSec: stats ? +(stats.tokensOut / (stats.genMs / 1000)).toFixed(1) : undefined,
    decodeTokPerSec:
      stats && decodeMs > 0 ? +(stats.tokensOut / (decodeMs / 1000)).toFixed(1) : undefined,
    textHead: text.slice(0, 80).replace(/\n/g, '⏎'),
  };
  console.log(
    `[arm:${arm}] tokens=${r.tokensOut} genMs=${r.genMs} ttftMs=${r.ttftMs} wallMs=${r.wallMs}` +
      ` rawTokPerSec=${r.rawTokPerSec} decodeTokPerSec=${r.decodeTokPerSec}`,
  );
  return r;
}

async function main(): Promise<void> {
  for (const f of [SIDECAR_BIN, MODEL_PATH, FIXTURE, MINI_GRAMMAR]) {
    if (!existsSync(f)) throw new Error(`missing: ${f}`);
  }
  const prompt = buildPrompt();
  const fullGrammar = zodToGbnf(LectureNoteSchema, 'LectureNote');
  const miniGrammar = readFileSync(MINI_GRAMMAR, 'utf8');
  console.log(
    `prompt chars=${prompt.length} fullGrammar chars=${fullGrammar.length} miniGrammar chars=${miniGrammar.length}`,
  );

  const proc = spawn(SIDECAR_BIN, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  const client = new SidecarClient(proc);
  const results: ArmResult[] = [];
  try {
    await client.waitForReady(10_000);
    const llm = new LlamaCppLLM(client);
    const tLoad = Date.now();
    await llm.loadModel(MODEL_PATH);
    console.log(`model loaded in ${Date.now() - tLoad}ms`);
    try {
      await runArm(client, 'warmup', prompt, undefined, 16);
      results.push(await runArm(client, 'plain-1', prompt, undefined, MAX_TOKENS));
      results.push(await runArm(client, 'mini', prompt, miniGrammar, MAX_TOKENS));
      results.push(await runArm(client, 'full-1', prompt, fullGrammar, MAX_TOKENS));
      results.push(await runArm(client, 'plain-2', prompt, undefined, MAX_TOKENS));
      results.push(await runArm(client, 'full-2', prompt, fullGrammar, MAX_TOKENS));
    } finally {
      await llm.unloadModel().catch(() => {});
    }
  } finally {
    proc.kill('SIGKILL');
  }

  console.log('\n=== SUMMARY (model: ' + MODEL_PATH.split('/').pop() + ') ===');
  console.log('arm      tokens  genMs   ttftMs  raw tok/s  decode tok/s');
  for (const r of results) {
    console.log(
      `${r.arm.padEnd(8)} ${String(r.tokensOut).padEnd(7)} ${String(r.genMs).padEnd(7)} ` +
        `${String(r.ttftMs).padEnd(7)} ${String(r.rawTokPerSec).padEnd(10)} ${r.decodeTokPerSec}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
