import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SidecarClient } from '../src/main/sidecar/client';
import { WhisperCppSTT } from '../src/main/engines/whisper-cpp-stt';
import { runSttEval, formatSttScorecard, type SttCondition } from '../eval/stt/run-stt-eval';
import { makeRealSttFn } from '../eval/stt/real-stt-fn';
import { ensurePcmWav16kMono } from '../eval/stt/audio-convert';
import { saveHypAsLectureFixture } from '../eval/stt/save-hyp-fixture';

interface CliArgs {
  saveAs?: string;
  snrDb: number;
  modelId: string;
  realAudio?: string;
  saveHypFixture?: string;
}

export function __testOnly_parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { snrDb: 5, modelId: 'kotoba-whisper-v2.0-q5_0' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--baseline') out.saveAs = argv[++i];
    else if (a === '--snr-db') out.snrDb = parseFloat(argv[++i] ?? '5');
    else if (a === '--model-id') out.modelId = argv[++i] ?? out.modelId;
    else if (a === '--real-audio') out.realAudio = argv[++i];
    else if (a === '--save-hyp-fixture') out.saveHypFixture = argv[++i];
  }
  return out;
}

/** Read a PCM 16-bit mono WAV with a 44-byte header (the shape
 *  `generate-ja-30s.sh` emits via `ffmpeg -map_metadata -1 -bitexact`)
 *  into a Float32Array normalized to [-1, 1). Same conversion the
 *  WhisperCppSTT integration test uses. */
export function __testOnly_readWavAsFloat32(buf: Buffer): { pcm: Float32Array; sampleRate: number } {
  if (buf.subarray(0, 4).toString('ascii') !== 'RIFF') throw new Error('not a RIFF WAV');
  if (buf.subarray(36, 40).toString('ascii') !== 'data') {
    throw new Error('header is not exactly 44 bytes — regenerate with generate-ja-30s.sh');
  }
  const sampleRate = buf.readUInt32LE(24);
  const i16 = new Int16Array(buf.buffer, buf.byteOffset + 44, (buf.byteLength - 44) / 2);
  const f32 = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) f32[i] = (i16[i] ?? 0) / 32768;
  return { pcm: f32, sampleRate };
}

async function main(): Promise<void> {
  const opts = __testOnly_parseArgs(process.argv);
  const modelPath = process.env.LISNA_TEST_STT_MODEL;
  if (!modelPath) {
    console.error('LISNA_TEST_STT_MODEL must point to the kotoba/whisper GGML bin');
    process.exit(1);
  }
  if (opts.saveHypFixture && !opts.realAudio) {
    console.error('--save-hyp-fixture requires --real-audio (no far-field-real row would exist otherwise)');
    process.exit(1);
  }
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const sidecarBin = process.env.LISNA_SIDECAR_BIN ?? resolve(__dirname, '../resources/sidecar');
  const fixDir = resolve(__dirname, '../tests/fixtures');
  const evalFixturesRoot = resolve(__dirname, '../eval/fixtures');

  const clean = __testOnly_readWavAsFloat32(readFileSync(join(fixDir, 'audio/ja-30s.wav')));
  const noise = __testOnly_readWavAsFloat32(readFileSync(join(fixDir, 'audio/ja-bg-noise-30s.wav')));
  const reference = readFileSync(join(fixDir, 'transcripts/ja-30s.txt'), 'utf8').trim();

  if (clean.sampleRate !== noise.sampleRate) {
    throw new Error(`sampleRate mismatch: clean=${clean.sampleRate} noise=${noise.sampleRate}`);
  }

  const conditions: SttCondition[] = ['clean', 'far-field-synth'];
  let realAudio: Float32Array | undefined;
  if (opts.realAudio) {
    const convertedPath = opts.realAudio + '.16k-mono.wav';
    await ensurePcmWav16kMono(opts.realAudio, convertedPath, 30);
    const r = __testOnly_readWavAsFloat32(readFileSync(convertedPath));
    if (r.sampleRate !== clean.sampleRate) {
      throw new Error(`real-audio sampleRate ${r.sampleRate} != clean ${clean.sampleRate}`);
    }
    realAudio = r.pcm;
    conditions.push('far-field-real');
    console.log(`real-audio         ${opts.realAudio} → ${convertedPath} (${r.pcm.length} samples)`);
  }

  const proc = spawn(sidecarBin, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  const client = new SidecarClient(proc);
  const t0 = Date.now();
  try {
    await client.waitForReady(10_000);
    const stt = new WhisperCppSTT(client);
    await stt.loadModel(modelPath, 'ja');
    try {
      const card = await runSttEval({
        sampleRate: clean.sampleRate,
        audio: clean.pcm,
        reference,
        noise: noise.pcm,
        snrDb: opts.snrDb,
        conditions,
        stt: makeRealSttFn(stt),
        modelId: opts.modelId,
        realAudio,
      });
      console.log(formatSttScorecard(card));
      console.log(`runMs              ${Date.now() - t0}`);
      if (opts.saveAs) {
        const out = join('eval/baselines', `stt-${opts.saveAs}.json`);
        mkdirSync(dirname(out), { recursive: true });
        writeFileSync(out, JSON.stringify({
          savedAt: new Date().toISOString(),
          modelId: opts.modelId,
          snrDb: opts.snrDb,
          card,
        }, null, 2));
        console.log(`baseline saved → ${out}`);
      }
      if (opts.saveHypFixture) {
        const realRow = card.rows.find((r) => r.condition === 'far-field-real');
        if (!realRow) throw new Error('expected a far-field-real row when --save-hyp-fixture is set');
        const written = saveHypAsLectureFixture({
          fixtureId: opts.saveHypFixture,
          hyp: realRow.hyp,
          reference,
          durationSec: 30,
          sttModelId: opts.modelId,
          fixturesRoot: evalFixturesRoot,
        });
        console.log(`fixture written  → ${written.dir}`);
        console.log(`next            → pnpm --filter @lisna/desktop eval:notes --family lecture --fixture ${opts.saveHypFixture} --runner offline-3b --baseline v0-3b-lecture-realstt`);
      }
    } finally {
      await stt.unloadModel().catch(() => {});
    }
  } finally {
    proc.kill('SIGKILL');
  }
}

const _isMain = fileURLToPath(import.meta.url) === process.argv[1];
if (_isMain) {
  main().catch(e => { console.error(e); process.exit(1); });
}
