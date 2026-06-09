import { describe, it, expect } from 'vitest';
import {
  __testOnly_isPcmWav16kMono,
  __testOnly_buildFfmpegArgs,
} from './audio-convert';

/** Build a minimal 44-byte WAV header for any combination of fmt fields.
 *  Same shape generate-ja-30s.sh emits (RIFF + fmt + data, no LIST/INFO). */
function makeHeader(opts: {
  riff?: string;
  wave?: string;
  fmt?: string;
  fmtSize?: number;
  format?: number;
  channels?: number;
  sampleRate?: number;
  bitsPerSample?: number;
  dataMagic?: string;
} = {}): Buffer {
  const buf = Buffer.alloc(44);
  buf.write(opts.riff ?? 'RIFF', 0);
  buf.writeUInt32LE(36, 4);
  buf.write(opts.wave ?? 'WAVE', 8);
  buf.write(opts.fmt ?? 'fmt ', 12);
  buf.writeUInt32LE(opts.fmtSize ?? 16, 16);
  buf.writeUInt16LE(opts.format ?? 1, 20); // PCM
  buf.writeUInt16LE(opts.channels ?? 1, 22);
  buf.writeUInt32LE(opts.sampleRate ?? 16000, 24);
  buf.writeUInt32LE((opts.sampleRate ?? 16000) * (opts.channels ?? 1) * 2, 28);
  buf.writeUInt16LE((opts.channels ?? 1) * 2, 32);
  buf.writeUInt16LE(opts.bitsPerSample ?? 16, 34);
  buf.write(opts.dataMagic ?? 'data', 36);
  buf.writeUInt32LE(0, 40);
  return buf;
}

describe('isPcmWav16kMono', () => {
  it('accepts the exact generate-ja-30s.sh header (16k mono PCM s16le)', () => {
    expect(__testOnly_isPcmWav16kMono(makeHeader())).toBe(true);
  });

  it('rejects non-RIFF header', () => {
    expect(__testOnly_isPcmWav16kMono(makeHeader({ riff: 'XXXX' }))).toBe(false);
  });

  it('rejects non-WAVE container', () => {
    expect(__testOnly_isPcmWav16kMono(makeHeader({ wave: 'XXXX' }))).toBe(false);
  });

  it('rejects 44100 Hz sample rate', () => {
    expect(__testOnly_isPcmWav16kMono(makeHeader({ sampleRate: 44100 }))).toBe(false);
  });

  it('rejects stereo (channels=2)', () => {
    expect(__testOnly_isPcmWav16kMono(makeHeader({ channels: 2 }))).toBe(false);
  });

  it('rejects non-PCM format codes (e.g. 3 = float)', () => {
    expect(__testOnly_isPcmWav16kMono(makeHeader({ format: 3 }))).toBe(false);
  });

  it('rejects 24-bit samples', () => {
    expect(__testOnly_isPcmWav16kMono(makeHeader({ bitsPerSample: 24 }))).toBe(false);
  });

  it('rejects when data magic is not at byte 36 (LIST/INFO chunk present)', () => {
    expect(__testOnly_isPcmWav16kMono(makeHeader({ dataMagic: 'LIST' }))).toBe(false);
  });

  it('rejects buffer shorter than 44 bytes', () => {
    expect(__testOnly_isPcmWav16kMono(Buffer.alloc(10))).toBe(false);
  });
});

describe('buildFfmpegArgs', () => {
  it('matches the generate-ja-30s.sh invocation shape', () => {
    const args = __testOnly_buildFfmpegArgs('/tmp/in.m4a', '/tmp/out.wav', 30);
    expect(args).toEqual([
      '-y',
      '-loglevel', 'error',
      '-i', '/tmp/in.m4a',
      '-map_metadata', '-1',
      '-bitexact',
      '-t', '30',
      '-ar', '16000',
      '-ac', '1',
      '-c:a', 'pcm_s16le',
      '/tmp/out.wav',
    ]);
  });

  it('honors a custom duration cap', () => {
    const args = __testOnly_buildFfmpegArgs('/tmp/in.m4a', '/tmp/out.wav', 45);
    const tIdx = args.indexOf('-t');
    expect(args[tIdx + 1]).toBe('45');
  });
});
