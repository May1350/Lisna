// Spike 1.1 runner — merge-LLM call on a 2-chunk JA Interview fixture.
// Per Plan 6 Phase B (Tasks 5-6) + spec §5.2b (merge contract).
//
// ── Process model (hardware safety, `pitfalls.md (spike-llm)`) ──────────────
// ONE invocation == ONE seed. Drive the 3 seeds (3000/3001/3002) as 3 SEPARATE
// foreground processes via the shell loop in README.md, with a cooldown between
// them so transient RSS drains on M3/8GB. Within a process, each of the 3 LLM
// calls (chunk0 → chunk1 → merge) is a fresh `runLlamaCli` SUBPROCESS that
// loads the model, generates, and exits — so peak resident set is ONE
// `llama-completion` at a time, never a long-lived resident model.
// NEVER run this with run_in_background.
//
// Seed for this run is read from SPIKE_SEED (default 3000). Output goes to
// results/seed-<SPIKE_SEED>/{chunk-0,chunk-1,merge,timing}.json.
//
// ── Binary path ────────────────────────────────────────────────────────────
// `build-spike/bin/llama-completion` is a gitignored build artifact present in
// the MAIN checkout but NOT in this worktree. Pass its absolute path via
// SPIKE_LLAMA_BIN (see README). Model path via SPIKE_LLM_MODEL_PATH (rig default).
//
// ── Faithfulness to production + documented deviations ─────────────────────
// Mirrors `orchestrator.ts::finalizeMeeting` (interview requiresDiarization):
//   zodToGbnf(schema,'InterviewNote') → selectPromptVariant → per-chunk
//   callWithGrammar<unknown>({schema:z.unknown()}) → hydrate → schema.parse,
//   then a merge call over both partials via prompt.mergeUserTemplate.
// It uses the REAL landed interview-v1 prompt (systemTemplate / chunkUserTemplate
// / mergeUserTemplate), not a lifted skeleton — so the spike measures the
// production prompt.
//
// THREE deviations from production, each load-bearing for the verdict:
//   (1) PROVENANCE HYDRATION: the stock `runPostDecodePipeline` Stage-3 fills
//       `from` only on leaves with text/term/expression. InterviewNote
//       qa_pairs[] use question/answer (no such key) yet REQUIRE `from`, so the
//       stock pipeline can't produce a valid InterviewNote. The spike uses a
//       local Interview-aware hydrator so the verdict measures MODEL merge
//       quality, not this pipeline gap. → FINDING: Task 13 must extend the
//       production provenance fill before wiring finalizeInterview.
//   (2) RAW PROMPT: runLlamaCli sends `systemTemplate\n\nuserPrompt` raw via
//       `-p` (no GGUF chat template). Production applies the Llama-3.2 template
//       in the sidecar. The spike is therefore a conservative LOWER BOUND on
//       quality. → caveat in the verdict memo.
//   (3) PER-CALL COLD LOAD: each call reloads the model (fresh subprocess), so
//       C6 latency INCLUDES cold model load. Production amortizes one load
//       across chunks+merge. → a C6 latency fail in the spike does not by itself
//       mean production fails C6; caveat in the memo.
//
// Path G (.max(N) bounded GBNF, plan Task 17) has NOT landed: zodToGbnf emits
// unbounded arrays and Zod enforces the bounds at parse (same as production
// lecture/meeting today). For this tiny fixture the model won't approach the
// caps, so this does not block the spike.

import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { z } from 'zod';
import { runLlamaCli } from '../../phase-0/01-zod-to-gbnf/llama-cli-rig';
import { zodToGbnf } from '@shared/note-schema/zod-to-gbnf';
import { computeProvenance } from '@shared/note-schema/provenance';
import { callWithGrammar, type LlmGenerator } from '../../../src/main/sidecar/grammar-call';
import { selectPromptVariant, familyCoreRegistry } from '@shared/families';
import type { SessionTranscript, Speaker } from '@shared/note-schema/transcript';
import '@shared/families/interview/core'; // side-effect: register interview family in the registry

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(HERE, 'fixture-2chunk-interview.json');
const RESULTS_ROOT = resolve(HERE, 'results');

const SEED = Number(process.env.SPIKE_SEED ?? '3000');
const MERGE_SEED_OFFSET = 50;
const TEMPERATURE = 0.4;
const MAX_TOKENS = 4096;
const MAX_ATTEMPTS = 3;
const INTER_CALL_COOLDOWN_MS = 5000;
const LLAMA_BIN = process.env.SPIKE_LLAMA_BIN; // undefined → rig default (worktree-local, likely missing)

interface FixtureSegment { ts: number; endTs?: number; speakerId: number; text: string }
interface FixtureChunk { chunkIndex: number; transcriptSegments: FixtureSegment[] }
interface Fixture { sessionId: string; speakers: Speaker[]; chunks: FixtureChunk[] }

interface ChunkRunResult {
  chunkIndex: number;
  ok: boolean;
  parseErrorReason?: string;
  latencyMs: number;
  attemptsUsed: number;
  note?: unknown;
}
interface MergeRunResult {
  ok: boolean;
  parseErrorReason?: string;
  latencyMs: number;
  attemptsUsed: number;
  merged?: unknown;
}
interface RunResult {
  seed: number;
  chunks: ChunkRunResult[];
  merge: MergeRunResult;
  totalLatencyMs: number;
}

/** Fill `from` on InterviewNote provenance leaves the stock pipeline misses. See header deviation (1). */
function hydrateInterviewProvenance(node: unknown, transcript: SessionTranscript): void {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) hydrateInterviewProvenance(item, transcript);
    return;
  }
  const o = node as Record<string, unknown>;
  if (o.from === undefined && (typeof o.ts === 'number' || 'text' in o || 'question' in o)) {
    o.from = computeProvenance(
      { ts: typeof o.ts === 'number' ? o.ts : undefined },
      transcript,
    );
  }
  for (const k of Object.keys(o)) hydrateInterviewProvenance(o[k], transcript);
}

/** Mirror orchestrator.renderTranscriptWithSpeakers (interview = multi-speaker). */
function renderChunkWithSpeakers(chunk: FixtureChunk, speakers: Speaker[]): string {
  const lookup = new Map(speakers.map((s) => [s.id, s.name ?? `話者${s.id}`]));
  const speakerMap = speakers.map((s) => `Speaker ${s.id} = ${s.name ?? `話者${s.id}`}`).join(', ');
  const lines = chunk.transcriptSegments
    .map((s) => `[${formatTs(s.ts)}] [${lookup.get(s.speakerId) ?? `Speaker ${s.speakerId}`}] ${s.text}`)
    .join('\n');
  return `Speaker map: ${speakerMap}\n\n${lines}`;
}

function formatTs(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Build the callWithGrammar generator over the real `llama-completion` rig. */
function makeRigGenerator(): LlmGenerator {
  let grammarPath: string | null = null;
  return async ({ prompt, grammar, seed, temperature, maxTokens }) => {
    if (!grammarPath) {
      grammarPath = resolve(tmpdir(), `merge-spike-grammar-${process.pid}.gbnf`);
      writeFileSync(grammarPath, grammar);
    }
    const r = await runLlamaCli({
      prompt,
      grammarPath,
      maxTokens,
      temperature,
      seed,
      binPath: LLAMA_BIN,
    });
    return { text: r.text, seed };
  };
}

async function main(): Promise<void> {
  if (LLAMA_BIN && !existsSync(LLAMA_BIN)) {
    throw new Error(`SPIKE_LLAMA_BIN does not exist: ${LLAMA_BIN}`);
  }
  const runDir = resolve(RESULTS_ROOT, `seed-${SEED}`);
  mkdirSync(runDir, { recursive: true });

  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Fixture;

  // Full-interview transcript for provenance resolution (mirrors orchestrator
  // passing args.transcript, not just the chunk).
  const fullTranscript: SessionTranscript = {
    sessionId: fixture.sessionId,
    speakers: fixture.speakers,
    transcriptSegments: fixture.chunks.flatMap((c) =>
      c.transcriptSegments.map((s) => ({
        ts: s.ts,
        endTs: s.endTs ?? s.ts,
        text: s.text,
        speakerId: s.speakerId,
      })),
    ),
  };

  const fam = familyCoreRegistry['interview'];
  if (!fam) throw new Error('INTERVIEW_FAMILY_NOT_REGISTERED');
  const grammar = zodToGbnf(fam.schema, 'InterviewNote');
  const prompt = selectPromptVariant(fam.prompts, fam.defaultPromptVariant);
  const generator = makeRigGenerator();

  console.log(`\n=== Spike 1.1 run (seed=${SEED}) ===`);
  console.log(`grammar=${grammar.length} chars · prompt=${prompt.variantId} · bin=${LLAMA_BIN ?? '(rig default)'}`);

  const runStart = Date.now();
  const chunkResults: ChunkRunResult[] = [];
  const partials: unknown[] = [];

  // ── Per-chunk pass ──────────────────────────────────────────────────────
  for (const chunk of fixture.chunks) {
    const userPrompt = prompt.chunkUserTemplate({
      chunkIndex: chunk.chunkIndex,
      totalChunks: fixture.chunks.length,
      transcript: renderChunkWithSpeakers(chunk, fixture.speakers),
    });
    const combinedPrompt = `${prompt.systemTemplate}\n\n${userPrompt}`;

    const result = await callWithGrammar<unknown>({
      prompt: combinedPrompt,
      schema: z.unknown(),
      grammar,
      baseSeed: SEED,
      temperature: TEMPERATURE,
      maxAttempts: MAX_ATTEMPTS,
      maxTokens: MAX_TOKENS,
      generator,
    });

    const cr: ChunkRunResult = {
      chunkIndex: chunk.chunkIndex,
      ok: false,
      latencyMs: result.attempts.reduce((sum, a) => sum + a.latencyMs, 0),
      attemptsUsed: result.ok ? result.attemptsUsed : result.attempts.length,
    };
    if (result.ok) {
      try {
        const raw = result.value as Record<string, unknown>;
        hydrateInterviewProvenance(raw, fullTranscript);
        cr.note = fam.schema.parse(raw);
        cr.ok = true;
        partials.push(cr.note);
      } catch (e) {
        cr.parseErrorReason = `post-decode/zod: ${e instanceof Error ? e.message : String(e)}`;
      }
    } else {
      cr.parseErrorReason = result.finalReason;
    }
    chunkResults.push(cr);
    writeFileSync(resolve(runDir, `chunk-${chunk.chunkIndex}.json`), JSON.stringify(cr, null, 2));
    await sleep(INTER_CALL_COOLDOWN_MS);
  }

  // ── Merge pass (only if all chunks parsed) ──────────────────────────────
  let mergeResult: MergeRunResult;
  if (partials.length === fixture.chunks.length && prompt.mergeUserTemplate) {
    const mergeUser = prompt.mergeUserTemplate({ partials });
    const combinedMerge = `${prompt.systemTemplate}\n\n${mergeUser}`;
    const r = await callWithGrammar<unknown>({
      prompt: combinedMerge,
      schema: z.unknown(),
      grammar,
      baseSeed: SEED + MERGE_SEED_OFFSET,
      temperature: TEMPERATURE,
      maxAttempts: MAX_ATTEMPTS,
      maxTokens: MAX_TOKENS,
      generator,
    });
    mergeResult = {
      ok: false,
      latencyMs: r.attempts.reduce((sum, a) => sum + a.latencyMs, 0),
      attemptsUsed: r.ok ? r.attemptsUsed : r.attempts.length,
    };
    if (r.ok) {
      try {
        const raw = r.value as Record<string, unknown>;
        hydrateInterviewProvenance(raw, fullTranscript);
        mergeResult.merged = fam.schema.parse(raw);
        mergeResult.ok = true;
      } catch (e) {
        mergeResult.parseErrorReason = `post-decode/zod: ${e instanceof Error ? e.message : String(e)}`;
      }
    } else {
      mergeResult.parseErrorReason = r.finalReason;
    }
  } else {
    mergeResult = {
      ok: false,
      parseErrorReason: 'one or more chunks failed; merge skipped',
      latencyMs: 0,
      attemptsUsed: 0,
    };
  }
  writeFileSync(resolve(runDir, 'merge.json'), JSON.stringify(mergeResult, null, 2));

  const runResult: RunResult = {
    seed: SEED,
    chunks: chunkResults,
    merge: mergeResult,
    totalLatencyMs: Date.now() - runStart,
  };
  writeFileSync(resolve(runDir, 'timing.json'), JSON.stringify(runResult, null, 2));

  console.log(`  Chunk 0: ${chunkResults[0]?.ok ? 'PASS' : 'FAIL'} (${chunkResults[0]?.latencyMs}ms, ${chunkResults[0]?.attemptsUsed} att)`);
  console.log(`  Chunk 1: ${chunkResults[1]?.ok ? 'PASS' : 'FAIL'} (${chunkResults[1]?.latencyMs}ms, ${chunkResults[1]?.attemptsUsed} att)`);
  console.log(`  Merge:   ${mergeResult.ok ? 'PASS' : 'FAIL'} (${mergeResult.latencyMs}ms, ${mergeResult.attemptsUsed} att)`);
  if (!mergeResult.ok && mergeResult.parseErrorReason) console.log(`           reason: ${mergeResult.parseErrorReason.slice(0, 200)}`);
  console.log(`  Total:   ${runResult.totalLatencyMs}ms`);
  console.log(`Wrote ${runDir}`);
}

main().catch((err) => {
  console.error('Spike run failed:', err);
  process.exit(1);
});
