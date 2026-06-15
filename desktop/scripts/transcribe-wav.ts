/**
 * Transcribe an arbitrary 16 kHz mono WAV with a chosen Whisper GGML model,
 * via the real production sidecar + WhisperCppSTT path. STT-track eval
 * instrument: lets us A/B models (and later preprocessing / params) on the
 * founder's actual recordings, not just the synthetic ja-30s fixture.
 *
 *   LISNA_TEST_STT_MODEL=<ggml.bin> pnpm -s tsx scripts/transcribe-wav.ts <wav>
 *
 * Prints the joined transcript to stdout + a one-line diag (segs, wall) to
 * stderr. Reuses eval-stt's 44-byte-header WAV reader (the WavWriter shape).
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SidecarClient } from '../src/main/sidecar/client';
import { WhisperCppSTT } from '../src/main/engines/whisper-cpp-stt';
import { __testOnly_readWavAsFloat32 } from './eval-stt';

async function main(): Promise<void> {
  const wavPath = process.argv[2];
  const modelPath = process.env.LISNA_TEST_STT_MODEL;
  if (!wavPath || !modelPath) {
    console.error('usage: LISNA_TEST_STT_MODEL=<bin> tsx scripts/transcribe-wav.ts <wav>');
    process.exit(1);
  }
  const { pcm, sampleRate } = __testOnly_readWavAsFloat32(readFileSync(wavPath));
  if (sampleRate !== 16000) throw new Error(`expected 16k, got ${sampleRate}`);
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const sidecarBin = process.env.LISNA_SIDECAR_BIN ?? resolve(__dirname, '../resources/sidecar');
  const proc = spawn(sidecarBin, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  const client = new SidecarClient(proc);
  const t0 = Date.now();
  try {
    await client.waitForReady(10_000);
    const stt = new WhisperCppSTT(client);
    await stt.loadModel(modelPath, 'ja');
    try {
      const segs = await stt.transcribe(pcm);
      const text = segs.map((s) => s.text).join('');
      console.error(`DIAG segs=${segs.length} wall_ms=${Date.now() - t0} model=${modelPath.split('/').pop()}`);
      process.stdout.write(text + '\n');
    } finally {
      await stt.unloadModel().catch(() => {});
    }
  } finally {
    proc.kill('SIGKILL');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
