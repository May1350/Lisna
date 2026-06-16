import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WavWriter } from './audio-wav-writer';

describe('WavWriter crash-safety', () => {
  let f: string;
  afterEach(() => { try { fs.unlinkSync(f); } catch { /* ignore */ } });

  it('header reports the real data size after append WITHOUT close', () => {
    f = path.join(os.tmpdir(), `wav-crash-${process.pid}-${Math.floor(performance.now())}.wav`);
    const w = new WavWriter(f);
    w.append(new Float32Array(16000)); // 1s @ 16k mono -> 32000 data bytes
    // Simulate a crash: do NOT call close(). Read the header straight off disk.
    const h = fs.readFileSync(f);
    expect(h.readUInt32LE(40)).toBe(32000);     // data chunk size
    expect(h.readUInt32LE(4)).toBe(36 + 32000); // RIFF size
  });
});
