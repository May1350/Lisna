import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WavWriter } from '../audio-wav-writer';

const tmp = () => path.join(os.tmpdir(), `wav-${process.pid}-${Math.random().toString(36).slice(2)}.wav`);

describe('WavWriter', () => {
  const created: string[] = [];
  afterEach(() => { for (const p of created) fs.rmSync(p, { force: true }); created.length = 0; });

  it('writes a valid 16kHz mono PCM16 WAV with correct header sizes', () => {
    const p = tmp(); created.push(p);
    const w = new WavWriter(p);
    w.append(new Float32Array([0, 0.5, -0.5, 1, -1]));  // 5 samples
    w.append(new Float32Array([0.25]));                  // 1 more -> 6 total
    w.close();

    const buf = fs.readFileSync(p);
    expect(buf.byteLength).toBe(44 + 6 * 2);                       // header + 6xPCM16
    expect(buf.toString('ascii', 0, 4)).toBe('RIFF');
    expect(buf.toString('ascii', 8, 12)).toBe('WAVE');
    expect(buf.readUInt32LE(4)).toBe(36 + 6 * 2);                  // RIFF chunk size
    expect(buf.readUInt32LE(24)).toBe(16000);                     // sample rate
    expect(buf.readUInt16LE(22)).toBe(1);                         // mono
    expect(buf.readUInt16LE(34)).toBe(16);                        // bits/sample
    expect(buf.readUInt32LE(40)).toBe(6 * 2);                     // data chunk size
    expect(buf.readInt16LE(44 + 2)).toBe(Math.round(0.5 * 0x7fff)); // 2nd sample
    expect(buf.readInt16LE(44 + 6)).toBe(0x7fff);                 // 4th sample == 1 -> +full scale
  });

  // Phase 2 slice: dataBytes exposes the synchronously-known write cursor so a
  // quick-transcript slice never reads past what's been appended + fdatasync'd.
  it('dataBytes reflects the appended PCM byte count (the live write cursor)', () => {
    const p = tmp(); created.push(p);
    const w = new WavWriter(p);
    expect(w.dataBytes).toBe(0);
    w.append(new Float32Array(16_000)); // 1s @ 16kHz mono PCM16 = 32000 bytes
    expect(w.dataBytes).toBe(32_000);
    w.append(new Float32Array(8_000));  // +0.5s = +16000 bytes
    expect(w.dataBytes).toBe(48_000);
    w.close();
  });

  it('close() on an empty writer still produces a valid 44-byte header', () => {
    const p = tmp(); created.push(p);
    const w = new WavWriter(p);
    w.close();
    const buf = fs.readFileSync(p);
    expect(buf.byteLength).toBe(44);
    expect(buf.readUInt32LE(40)).toBe(0);  // data size 0
  });
});
