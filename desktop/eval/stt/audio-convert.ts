import { spawn } from 'node:child_process';
import { readFile, copyFile } from 'node:fs/promises';

/**
 * Detect whether a buffer's first 44 bytes match the exact PCM WAV shape
 * `generate-ja-30s.sh` emits — 16 kHz, mono, signed-16 little-endian, no
 * LIST/INFO chunk between `fmt ` and `data`. `__testOnly_readWavAsFloat32`
 * (eval-stt.ts) relies on this exact header layout when slicing PCM samples.
 */
export function __testOnly_isPcmWav16kMono(buf: Buffer): boolean {
  if (buf.length < 44) return false;
  if (buf.subarray(0, 4).toString('ascii') !== 'RIFF') return false;
  if (buf.subarray(8, 12).toString('ascii') !== 'WAVE') return false;
  if (buf.subarray(12, 16).toString('ascii') !== 'fmt ') return false;
  if (buf.readUInt32LE(16) !== 16) return false;
  if (buf.readUInt16LE(20) !== 1) return false; // PCM
  if (buf.readUInt16LE(22) !== 1) return false; // mono
  if (buf.readUInt32LE(24) !== 16000) return false;
  if (buf.readUInt16LE(34) !== 16) return false; // bits/sample
  if (buf.subarray(36, 40).toString('ascii') !== 'data') return false;
  return true;
}

/**
 * Argument vector for the canonical ffmpeg conversion. Same flag set as
 * `desktop/tests/fixtures/audio/generate-ja-30s.sh` so the output WAV's
 * 44-byte header lines up with `__testOnly_readWavAsFloat32`'s slicing.
 */
export function __testOnly_buildFfmpegArgs(
  inputPath: string,
  outputPath: string,
  durationSec: number,
): string[] {
  return [
    '-y',
    '-loglevel', 'error',
    '-i', inputPath,
    '-map_metadata', '-1',
    '-bitexact',
    '-t', String(durationSec),
    '-ar', '16000',
    '-ac', '1',
    '-c:a', 'pcm_s16le',
    outputPath,
  ];
}

/**
 * Ensure `outputPath` holds a 16 kHz mono PCM s16le WAV with the exact
 * 44-byte header `__testOnly_readWavAsFloat32` expects. If `inputPath`
 * already meets that shape it's copied straight through; otherwise ffmpeg
 * is invoked with the canonical flag set.
 *
 * `durationSec` is a hard cap applied via ffmpeg's `-t` — the reference
 * recording is 30 seconds, and the integration test slices samples
 * assuming a fixed length.
 */
export async function ensurePcmWav16kMono(
  inputPath: string,
  outputPath: string,
  durationSec = 30,
): Promise<void> {
  const head = await readFile(inputPath);
  if (head.length >= 44 && __testOnly_isPcmWav16kMono(head.subarray(0, 44))) {
    if (inputPath !== outputPath) await copyFile(inputPath, outputPath);
    return;
  }
  await runFfmpeg(__testOnly_buildFfmpegArgs(inputPath, outputPath, durationSec));
}

async function runFfmpeg(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    const stderrChunks: Buffer[] = [];
    proc.stderr?.on('data', (d: Buffer) => stderrChunks.push(d));
    proc.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') reject(new Error('ffmpeg not found on PATH — install via `brew install ffmpeg`'));
      else reject(err);
    });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${Buffer.concat(stderrChunks).toString('utf8').trim()}`));
    });
  });
}
