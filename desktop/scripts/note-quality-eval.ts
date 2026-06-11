/**
 * Note-quality eval rig — replay a REAL session dump's transcript through the
 * production prompt+grammar path with the real 3B, score the output for
 * grounding, and dump artifacts for judge review.
 *
 * Built for the 2026-06-11 fabrication incident (dump 2026-06-11T16-14-00-372Z:
 * a JA finance interview → the 3B emitted memorized ENGLISH boilerplate). The
 * rig answers, per prompt variant: does the model READ the transcript?
 *
 * Scores per run:
 *   - jaRatio        — JA-script share of user-visible strings (the #118 guard
 *                      metric; fabricated-EN ≈ 0.00, healthy JA ≥ 0.15)
 *   - grounding      — fraction of content tokens (kanji/katakana runs ≥ 2 +
 *                      ASCII words ≥ 4) in the note that literally appear in
 *                      the transcript. Fabrication scores near 0.
 *   - tsPlausibility — fraction of note ts values within [0, duration] that
 *                      are NOT multiples of 5 (the incident note's invented
 *                      ts were 0/10/20/30/40 — all round)
 *   - counts (qa_pairs / themes / takeaways), latency, tokensOut
 *
 * Transcript content is read from the dump dir at runtime — founder recordings
 * are NEVER committed to the repo.
 *
 * Run: cd desktop && pnpm tsx scripts/note-quality-eval.ts \
 *        [--dump 2026-06-11T16-14-00-372Z] [--variant interview-v1] \
 *        [--seed 7000] [--label baseline]
 * FOREGROUND ONLY — spawns real LLM inference (pitfalls.md spike-llm).
 */
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SidecarClient } from '../src/main/sidecar/client';
import { LlamaCppLLM } from '../src/main/engines/llama-cpp-llm';
import { TIMEOUTS } from '../src/main/sidecar/timeouts';
import { zodToGbnf } from '../src/shared/note-schema/zod-to-gbnf';
import { familyCoreRegistry } from '../src/shared/families';
import '../src/shared/families/interview/core'; // side-effect: register interview family
import { renderSystemTemplate, type PromptVariant } from '../src/shared/families/util/prompts';
import { adaptToV2Transcript } from '../src/shared/note-schema/adapt-legacy-transcript';
import { chunkTranscript } from '../src/shared/note-schema/chunking';
import { modelProfiles } from '../src/shared/models/profiles';
import type { SessionTranscript } from '../src/shared/note-schema/transcript';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SIDECAR_BIN = resolve(__dirname, '../resources/sidecar');
const MODEL_PATH =
  process.env.LISNA_TEST_LLM_MODEL ??
  resolve(process.env.HOME!, '.lisna-test-models/Llama-3.2-3B-Instruct-Q4_K_M.gguf');
const DUMP_ROOT = resolve(
  process.env.HOME!,
  'Library/Application Support/@lisna/desktop/sessions',
);
const OUT_DIR = '/tmp/lisna-prompt-eval';

// ─── args ─────────────────────────────────────────────────────────────────────
function arg(name: string, dflt: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : dflt;
}
const DUMP = arg('dump', '2026-06-11T16-14-00-372Z');
const VARIANT_ID = arg('variant', 'interview-v1');
const SEED = Number(arg('seed', '7000'));
const LABEL = arg('label', VARIANT_ID);
const MAX_TOKENS_OVERRIDE = Number(arg('max-tokens', '0')) || null;

// ─── prompt assembly (mirrors finalizeInterview 1:1) ──────────────────────────

function formatTs(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Mirrors orchestrator.ts::renderTranscriptWithSpeakers — keep in lockstep. */
function renderTranscriptWithSpeakers(
  chunk: SessionTranscript,
  speakers: SessionTranscript['speakers'],
): string {
  const lookup = new Map(speakers.map((s) => [s.id, s.name ?? `話者${s.id}`]));
  const speakerMap = speakers.map((s) => `Speaker ${s.id} = ${s.name ?? `話者${s.id}`}`).join(', ');
  const lines = chunk.transcriptSegments
    .map((s) => `[${formatTs(s.ts)}] [${lookup.get(s.speakerId) ?? `Speaker ${s.speakerId}`}] ${s.text}`)
    .join('\n');
  return `Speaker map: ${speakerMap}\n\n${lines}`;
}

// ─── scoring ──────────────────────────────────────────────────────────────────

const JA_SCRIPT_RE = /[぀-ゟ゠-ヿ一-鿿㐀-䶿｡-ﾟ\u3000-〿]/g;
const SYSTEM_KEYS = new Set(['family', 'language', 'from', 'model', 'generatedAt', 'experimentArmId']);

function collectStrings(v: unknown, out: string[]): void {
  if (typeof v === 'string') { out.push(v); return; }
  if (Array.isArray(v)) { for (const x of v) collectStrings(x, out); return; }
  if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      if (SYSTEM_KEYS.has(k)) continue;
      collectStrings(x, out);
    }
  }
}

function collectNumbers(v: unknown, key: string, out: number[]): void {
  if (Array.isArray(v)) { for (const x of v) collectNumbers(x, key, out); return; }
  if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      if ((k === key || k === 'appears_at_ts') && typeof x === 'number') out.push(x);
      else collectNumbers(x, key, out);
    }
  }
}

interface Scores {
  jaRatio: number;
  groundingJa: number;   // kanji/katakana runs (≥2 chars) found in transcript
  groundingAscii: number; // ASCII words (≥4 chars) found in transcript
  tsInRange: number;
  tsNonRound: number;
  qaPairs: number;
  themes: number;
  takeaways: number;
  checkedChars: number;
}

function scoreNote(note: unknown, transcriptText: string, durationSec: number): Scores {
  const parts: string[] = [];
  collectStrings(note, parts);
  const text = parts.join('');
  const jaChars = (text.match(JA_SCRIPT_RE) ?? []).length;
  const jaRatio = text.length ? jaChars / text.length : 0;

  const jaRuns = [...new Set(text.match(/[一-鿿㐀-䶿゠-ヿ]{2,}/g) ?? [])];
  const groundedJa = jaRuns.filter((r) => transcriptText.includes(r)).length;
  const asciiWords = [...new Set((text.match(/[a-zA-Z]{4,}/g) ?? []).map((w) => w.toLowerCase()))];
  const groundedAscii = asciiWords.filter((w) => transcriptText.toLowerCase().includes(w)).length;

  const tsVals: number[] = [];
  collectNumbers(note, 'ts', tsVals);
  const inRange = tsVals.filter((t) => t >= 0 && t <= durationSec + 5).length;
  const nonRound = tsVals.filter((t) => t % 5 !== 0).length;

  const n = note as Record<string, unknown>;
  return {
    jaRatio: +jaRatio.toFixed(3),
    groundingJa: jaRuns.length ? +(groundedJa / jaRuns.length).toFixed(3) : 0,
    groundingAscii: asciiWords.length ? +(groundedAscii / asciiWords.length).toFixed(3) : 0,
    tsInRange: tsVals.length ? +(inRange / tsVals.length).toFixed(3) : 0,
    tsNonRound: tsVals.length ? +(nonRound / tsVals.length).toFixed(3) : 0,
    qaPairs: Array.isArray(n.qa_pairs) ? n.qa_pairs.length : 0,
    themes: Array.isArray(n.themes) ? n.themes.length : 0,
    takeaways: Array.isArray(n.key_takeaways) ? n.key_takeaways.length : 0,
    checkedChars: text.length,
  };
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  for (const f of [SIDECAR_BIN, MODEL_PATH]) {
    if (!existsSync(f)) throw new Error(`missing: ${f}`);
  }
  const dumpDir = join(DUMP_ROOT, DUMP);
  const raw = JSON.parse(readFileSync(join(dumpDir, 'transcript.json'), 'utf8')) as {
    durationSec: number;
    segments: Array<{ startSec: number; endSec: number; text: string; noSpeechProb?: number }>;
  };
  const transcript = adaptToV2Transcript(raw.segments, `eval-${DUMP}`);
  const transcriptText = raw.segments.map((s) => s.text).join('');

  const fam = familyCoreRegistry['interview'];
  if (!fam) throw new Error('interview family not registered');
  const variant: PromptVariant | undefined = fam.prompts.find((p) => p.variantId === VARIANT_ID);
  if (!variant) throw new Error(`unknown variant: ${VARIANT_ID} (have: ${fam.prompts.map((p) => p.variantId).join(', ')})`);

  const tuning = modelProfiles['llama-3.2-3b-q4-km']!.perFamily.interview;
  const chunks = chunkTranscript(transcript, tuning.recommendedChunkTokens);
  console.log(`[rig] dump=${DUMP} dur=${raw.durationSec}s segs=${raw.segments.length} chunks=${chunks.length} variant=${VARIANT_ID} seed=${SEED}`);

  const chunk = chunks[0]!;
  const userPrompt = variant.chunkUserTemplate({
    chunkIndex: 0,
    totalChunks: chunks.length,
    transcript: renderTranscriptWithSpeakers(chunk, transcript.speakers),
  });
  const systemPrompt = renderSystemTemplate(variant.systemTemplate, 'ja');
  const prompt = userPrompt; // role split (2026-06-12): system sent as its own turn
  const grammar = zodToGbnf(fam.schema, 'InterviewNote');
  const maxTokens = MAX_TOKENS_OVERRIDE ?? tuning.maxGenTokens;
  console.log(`[rig] promptChars=${prompt.length} grammarChars=${grammar.length} maxTokens=${maxTokens}${MAX_TOKENS_OVERRIDE ? ' (OVERRIDE — wedge workaround, see primer comment)' : ''}`);

  const proc: ChildProcess = spawn(SIDECAR_BIN, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    const client = new SidecarClient(proc);
    await client.waitForReady(15_000);
    const llm = new LlamaCppLLM(client);
    console.log('[rig] loading 3B…');
    await llm.loadModel(MODEL_PATH);

    // Metal cold-cache warmup (mirrors grammar-ab.ts's warmup arm +
    // profiles.ts warmupRequired). Without this, the very first prefill on a
    // cold cache can exceed the 60s no-progress timeout — observed twice on
    // this rig before the warmup was added.
    console.log('[rig] warmup (16-token plain generate)…');
    const tw = Date.now();
    // 180s window: the cold-cache first decode can exceed the production 60s
    // no-progress timeout on a swap-pressured 8GB machine; production absorbs
    // this via supervisor respawn+reload, the rig just waits longer once.
    for await (const _ of client.sendStream(
      { type: 'generate', messages: [{ role: 'user', content: 'こんにちは' }], seed: 1, temperature: 0.4, maxTokens: 16 },
      { timeoutMs: 180_000 },
    )) { /* drain */ }
    console.log(`[rig] warmup done in ${Date.now() - tw}ms`);

    // First-big-batch primer: under memory pressure the FIRST large prefill
    // batch in a process can grind for minutes (observed 141s+ while the same
    // prompt re-prefills in ~30s right after — Metal graph/alloc pathology).
    // Production's 60s watchdog turns that into a deterministic 3× stall-kill
    // loop. The rig eats that cost once with maxTokens=1, then measures the
    // real call on a hot pipeline.
    // PLAIN primer (no grammar) — empirically the only sequence that unwedges
    // the subsequent grammar call on this machine state: plain-big-prefill →
    // grammar call ran at normal speed (36s), while grammar→grammar and
    // cold→grammar both wedged 300s+. Mirrors the successful discriminator.
    console.log('[rig] primer (real prompt, PLAIN no-grammar, maxTokens=8, up to 600s)…');
    const tp = Date.now();
    try {
      for await (const _ of client.sendStream(
        { type: 'generate', messages: [{ role: 'user', content: prompt }], seed: 1, temperature: tuning.temperature, maxTokens: 8 },
        { timeoutMs: 600_000 },
      )) { /* drain */ }
      console.log(`[rig] primer done in ${Date.now() - tp}ms`);
    } catch (e) {
      console.log(`[rig] primer itself timed out after ${Date.now() - tp}ms — continuing anyway (${String(e).slice(0, 60)})`);
    }

    let text = '';
    let stats: { tokensOut: number; genMs: number } | undefined;
    const t0 = Date.now();
    for await (const tok of client.sendStream(
      {
        type: 'generate',
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: prompt }],
        grammar,
        seed: SEED,
        temperature: tuning.temperature,
        maxTokens,
      },
      // 300s window (vs production 60s no-progress): under swap pressure the
      // ~3k-token prefill alone can exceed 60s — the rig measures PROMPT
      // QUALITY, so it waits prefill out rather than reproducing the
      // production timeout. TTFT is visible in wallMs - genMs anyway.
      { timeoutMs: 300_000, onDone: (s) => { stats = s; } },
    )) {
      text += tok;
    }
    const wallMs = Date.now() - t0;

    let note: unknown = null;
    let parseError: string | undefined;
    try { note = JSON.parse(text); } catch (e) {
      parseError = String(e);
      // Lenient repair for maxTokens-truncated output (eval-only): cut back to
      // the last complete value and close open strings/brackets so the partial
      // can still be scored for language/grounding.
      const cut = text.replace(/,\s*"[^"]*$/, '').replace(/,\s*$/, '');
      const opens: string[] = [];
      let inStr = false, esc = false;
      for (const ch of cut) {
        if (esc) { esc = false; continue; }
        if (ch === '\\') { esc = true; continue; }
        if (ch === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (ch === '{' || ch === '[') opens.push(ch);
        if (ch === '}' || ch === ']') opens.pop();
      }
      const closer = (inStr ? '"' : '') + opens.reverse().map((c) => (c === '{' ? '}' : ']')).join('');
      try { note = JSON.parse(cut + closer); parseError += ' (repaired for scoring)'; } catch { /* unrecoverable */ }
    }

    const scores = note ? scoreNote(note, transcriptText, raw.durationSec) : null;
    const result = {
      label: LABEL, variantId: VARIANT_ID, seed: SEED, dump: DUMP,
      promptChars: prompt.length, wallMs, tokensOut: stats?.tokensOut, genMs: stats?.genMs,
      rawTokPerSec: stats ? +(stats.tokensOut / (stats.genMs / 1000)).toFixed(1) : undefined,
      parseError, scores, note,
    };

    mkdirSync(OUT_DIR, { recursive: true });
    const outPath = join(OUT_DIR, `${LABEL}-seed${SEED}.json`);
    writeFileSync(outPath, JSON.stringify(result, null, 2));
    console.log(`[rig] wallMs=${wallMs} tokensOut=${stats?.tokensOut} tokPerSec=${result.rawTokPerSec}`);
    console.log(`[rig] parseError=${parseError ?? 'none'}`);
    console.log(`[rig] scores=${JSON.stringify(scores)}`);
    console.log(`[rig] → ${outPath}`);
  } finally {
    try {
      proc.kill('SIGTERM');
      await new Promise<void>((r) => {
        const t = setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* dead */ } r(); }, 5000);
        proc.once('exit', () => { clearTimeout(t); r(); });
      });
    } catch { /* already dead */ }
    try { execSync('pkill -9 -f llama-completion', { stdio: 'ignore' }); } catch { /* none */ }
  }
}

main().catch((e) => {
  console.error('[rig] FATAL', e);
  try { execSync('pkill -9 -f llama-completion', { stdio: 'ignore' }); } catch { /* none */ }
  process.exit(1);
});
