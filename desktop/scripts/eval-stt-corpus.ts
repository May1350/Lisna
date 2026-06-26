// Founder-free STT accuracy eval: run the crafted TTS corpus
// (tests/fixtures/stt-corpus/*.wav, generated from *.txt via `say`+ffmpeg —
// see generate.sh) through the REAL Whisper sidecar and report CER/WER per clip
// + aggregate, for clean and synthetic far-field conditions. No founder
// recording needed — the .txt IS the ground truth.
//
// FOREGROUND ONLY (spawns the sidecar; Whisper is ~0.5GB, safe on 8GB — unlike
// the LLM eval). Sweep: the sidecar is SIGKILLed in `finally`.
//
// Usage (from desktop/):
//   LISNA_TEST_STT_MODEL="$HOME/.lisna-test-models/ggml-large-v3-turbo-q5_0.bin" \
//     pnpm exec tsx scripts/eval-stt-corpus.ts [--initial-prompt "<terms>"] [--model-id <id>] [--snr-db 5]
//
// Glossary A/B: run twice, once without --initial-prompt and once with the
// corpus proper-nouns, and compare the CERnorm columns.
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SidecarClient } from '../src/main/sidecar/client';
import { WhisperCppSTT } from '../src/main/engines/whisper-cpp-stt';
import { runSttEval, type SttCondition } from '../eval/stt/run-stt-eval';
import { makeRealSttFn } from '../eval/stt/real-stt-fn';
import { cer, normalizeForCer } from '../eval/stt/metrics';
import { __testOnly_readWavAsFloat32 as readWav } from './eval-stt';

interface Args { modelId: string; initialPrompt?: string; snrDb: number; }
function parseArgs(argv: string[]): Args {
  const out: Args = { modelId: 'large-v3-turbo-q5_0', snrDb: 5 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--model-id') out.modelId = argv[++i] ?? out.modelId;
    else if (a === '--initial-prompt') out.initialPrompt = argv[++i];
    else if (a === '--snr-db') out.snrDb = parseFloat(argv[++i] ?? '5');
  }
  return out;
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const modelPath = process.env.LISNA_TEST_STT_MODEL;
  if (!modelPath) { console.error('set LISNA_TEST_STT_MODEL to the whisper GGML bin'); process.exit(1); }

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const sidecarBin = process.env.LISNA_SIDECAR_BIN ?? resolve(__dirname, '../resources/sidecar');
  const corpusDir = resolve(__dirname, '../tests/fixtures/stt-corpus');
  const noise = readWav(readFileSync(resolve(__dirname, '../tests/fixtures/audio/ja-bg-noise-30s.wav')));

  const clips = readdirSync(corpusDir).filter((f) => f.endsWith('.txt')).sort().map((txt) => {
    const id = basename(txt, '.txt');
    return { id, wavPath: join(corpusDir, `${id}.wav`), reference: readFileSync(join(corpusDir, txt), 'utf8').trim() };
  });
  const missing = clips.filter((c) => !existsSync(c.wavPath));
  if (clips.length === 0 || missing.length) {
    console.error(`missing ${missing.length || 'all'} corpus wav(s) — run: bash tests/fixtures/stt-corpus/generate.sh`);
    process.exit(1);
  }

  const proc = spawn(sidecarBin, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  const client = new SidecarClient(proc);
  const t0 = Date.now();
  try {
    await client.waitForReady(15_000);
    const stt = new WhisperCppSTT(client);
    await stt.loadModel(modelPath, 'ja');
    const sttFn = makeRealSttFn(stt, args.initialPrompt ? { initialPrompt: args.initialPrompt } : undefined);
    const agg: Record<string, { raw: number[]; norm: number[] }> = {};
    try {
      for (const clip of clips) {
        const clean = readWav(readFileSync(clip.wavPath));
        const card = await runSttEval({
          sampleRate: clean.sampleRate, audio: clean.pcm, reference: clip.reference,
          noise: noise.pcm, snrDb: args.snrDb,
          conditions: ['clean', 'far-field-synth'] as SttCondition[],
          stt: sttFn, modelId: args.modelId,
        });
        for (const row of card.rows) {
          const nCer = cer(normalizeForCer(clip.reference), normalizeForCer(row.hyp));
          (agg[row.condition] ??= { raw: [], norm: [] }).raw.push(row.cer);
          agg[row.condition].norm.push(nCer);
          console.log(`${clip.id.padEnd(16)} ${row.condition.padEnd(16)} CERraw=${pct(row.cer).padStart(7)}  CERnorm=${pct(nCer).padStart(7)}`);
          if (row.condition === 'clean') {
            console.log(`   ref: ${clip.reference}`);
            console.log(`   hyp: ${row.hyp}`);
          }
        }
      }
      console.log('\n=== aggregate (mean CER over corpus) ===');
      for (const [cond, a] of Object.entries(agg)) {
        console.log(`${cond.padEnd(16)} CERraw=${pct(mean(a.raw)).padStart(7)}  CERnorm=${pct(mean(a.norm)).padStart(7)}  (n=${a.raw.length})`);
      }
      console.log(`model=${args.modelId}  initialPrompt=${args.initialPrompt ? JSON.stringify(args.initialPrompt) : '(none)'}  runMs=${Date.now() - t0}`);
    } finally {
      await stt.unloadModel().catch(() => {});
    }
  } finally {
    proc.kill('SIGKILL');
  }
}

const _isMain = fileURLToPath(import.meta.url) === process.argv[1];
if (_isMain) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
