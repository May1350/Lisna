import fs from 'node:fs';
import { SAMPLE_RATE, wavHeader } from './audio-wav-writer';

const HEADER_BYTES = 44;
const BYTES_PER_SAMPLE = 2; // 16 kHz mono PCM16

/**
 * Slice `[startSec, endSec)` out of a 16 kHz mono PCM16 WAV into a NEW WAV at
 * `destPath` (fresh 44-byte header). Phase 2 quick-transcript slice (spec §4.3).
 *
 * Safe to call while the source is STILL being written by a WavWriter:
 *  - reads via its OWN read-only fd (the writer's fd is write-only/pwrite-managed);
 *  - CLAMPS the byte range to `maxDataBytes` (pass the live WavWriter.dataBytes)
 *    so it never reads past the last append()+fdatasync (guarantee 4).
 *
 * A degenerate/empty span (end <= start, or clamped to nothing) yields a valid
 * 0-data WAV — downstream STT returns [] → EMPTY_RECORDING.
 */
export function sliceWav(
  srcPath: string,
  startSec: number,
  endSec: number,
  maxDataBytes: number,
  destPath: string,
): string {
  const dataCeiling = HEADER_BYTES + Math.max(0, maxDataBytes);
  const clamp = (b: number): number => Math.max(HEADER_BYTES, Math.min(b, dataCeiling));
  const startByte = clamp(HEADER_BYTES + Math.floor(startSec * SAMPLE_RATE) * BYTES_PER_SAMPLE);
  let endByte = clamp(HEADER_BYTES + Math.floor(endSec * SAMPLE_RATE) * BYTES_PER_SAMPLE);
  if (endByte < startByte) endByte = startByte;
  const len = endByte - startByte;

  const src = fs.openSync(srcPath, 'r');
  try {
    const data = Buffer.allocUnsafe(len);
    if (len > 0) fs.readSync(src, data, 0, len, startByte);
    fs.writeFileSync(destPath, Buffer.concat([wavHeader(len), data]));
  } finally {
    fs.closeSync(src);
  }
  return destPath;
}
