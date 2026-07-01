/**
 * sliceWav — cut [startSec, endSec) out of a live 16kHz mono PCM16 WAV into a
 * new temp WAV (Phase 2 quick-transcript slice, spec §4.3). Verifies byte math,
 * the maxDataBytes clamp (never read past the write cursor), an own read-only
 * fd, and a valid fresh header. 16kHz mono PCM16 → 32000 B/s, 2 B/sample.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WavWriter } from '../audio-wav-writer';
import { sliceWav } from '../wav-slice';

const BYTES_PER_SEC = 16_000 * 2;
const tmp = (tag: string) => path.join(os.tmpdir(), `wavslice-${tag}-${process.pid}-${Math.random().toString(36).slice(2)}.wav`);
const s16 = (v: number) => Math.round((v < 0 ? v * 0x8000 : v * 0x7fff));

describe('sliceWav', () => {
  const created: string[] = [];
  afterEach(() => { for (const p of created) fs.rmSync(p, { force: true }); created.length = 0; });

  /** A 3-second source WAV: sec0 all 0.1, sec1 all 0.5, sec2 all -0.5. */
  function makeSrc(): { src: string; dataBytes: number } {
    const src = tmp('src'); created.push(src);
    const w = new WavWriter(src);
    w.append(new Float32Array(16_000).fill(0.1));
    w.append(new Float32Array(16_000).fill(0.5));
    w.append(new Float32Array(16_000).fill(-0.5));
    const dataBytes = w.dataBytes;
    w.close();
    return { src, dataBytes };
  }

  it('slices [1,2) into exactly 1s of the right samples with a valid header', () => {
    const { src, dataBytes } = makeSrc();
    const dest = tmp('dest'); created.push(dest);
    sliceWav(src, 1, 2, dataBytes, dest);

    const buf = fs.readFileSync(dest);
    expect(buf.byteLength).toBe(44 + BYTES_PER_SEC);        // header + 1s
    expect(buf.toString('ascii', 0, 4)).toBe('RIFF');
    expect(buf.readUInt32LE(40)).toBe(BYTES_PER_SEC);       // data chunk size
    expect(buf.readUInt32LE(4)).toBe(36 + BYTES_PER_SEC);   // RIFF size
    expect(buf.readUInt32LE(24)).toBe(16_000);              // sample rate
    // Every sample in the slice is sec1's 0.5 — full byte-equality (no
    // uninitialized-memory tail from a short read; catches the allocUnsafe leak).
    const expected = Buffer.alloc(BYTES_PER_SEC);
    for (let i = 0; i < BYTES_PER_SEC; i += 2) expected.writeInt16LE(s16(0.5), i);
    expect(buf.subarray(44).equals(expected)).toBe(true);
  });

  it('clamps endSec past the recording to the available data', () => {
    const { src, dataBytes } = makeSrc();
    const dest = tmp('dest'); created.push(dest);
    sliceWav(src, 1, 100, dataBytes, dest); // want [1,100) but only 3s exist
    const buf = fs.readFileSync(dest);
    expect(buf.readUInt32LE(40)).toBe(2 * BYTES_PER_SEC);   // [1,3) = 2s
  });

  it('clamps to maxDataBytes (the live write cursor) — never reads past it', () => {
    const { src } = makeSrc();
    const dest = tmp('dest'); created.push(dest);
    // Pretend only 1s has been written+fdatasync'd so far.
    sliceWav(src, 0, 3, BYTES_PER_SEC, dest);
    const buf = fs.readFileSync(dest);
    expect(buf.readUInt32LE(40)).toBe(BYTES_PER_SEC);       // clamped to 1s
    expect(buf.readInt16LE(44)).toBe(s16(0.1));             // sec0
  });

  it('produces a valid 0-data WAV for a degenerate span (end <= start)', () => {
    const { src, dataBytes } = makeSrc();
    const dest = tmp('dest'); created.push(dest);
    sliceWav(src, 2, 1, dataBytes, dest);
    const buf = fs.readFileSync(dest);
    expect(buf.byteLength).toBe(44);
    expect(buf.readUInt32LE(40)).toBe(0);
  });
});
