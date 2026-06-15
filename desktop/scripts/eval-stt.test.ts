import { describe, it, expect } from 'vitest';
import { __testOnly_parseArgs, __testOnly_readWavAsFloat32 } from './eval-stt';

describe('eval-stt parseArgs', () => {
  it('uses defaults when no flags', () => {
    const o = __testOnly_parseArgs(['node', 'eval-stt.ts']);
    expect(o.snrDb).toBe(5);
    expect(o.modelId).toBe('kotoba-whisper-v2.0-q5_0');
    expect(o.saveAs).toBeUndefined();
  });

  it('parses --baseline, --snr-db, --model-id', () => {
    const o = __testOnly_parseArgs([
      'node', 'eval-stt.ts',
      '--baseline', 'v0-stt',
      '--snr-db', '0',
      '--model-id', 'whisper-large-v3',
    ]);
    expect(o.saveAs).toBe('v0-stt');
    expect(o.snrDb).toBe(0);
    expect(o.modelId).toBe('whisper-large-v3');
  });

  it('handles negative snrDb (more aggressive far-field noise)', () => {
    const o = __testOnly_parseArgs(['node', 'eval-stt.ts', '--snr-db', '-3']);
    expect(o.snrDb).toBe(-3);
  });

  it('parses --initial-prompt (STT Phase 1 proper-noun bias)', () => {
    const o = __testOnly_parseArgs(['node', 'eval-stt.ts', '--initial-prompt', '明治ホールディングス、管理会計']);
    expect(o.initialPrompt).toBe('明治ホールディングス、管理会計');
  });

  it('initialPrompt is undefined by default', () => {
    expect(__testOnly_parseArgs(['node', 'eval-stt.ts']).initialPrompt).toBeUndefined();
  });
});

describe('readWavAsFloat32', () => {
  function makeWav(samples: number[], sampleRate = 16000): Buffer {
    // Minimal 44-byte WAV header (the same shape generate-ja-30s.sh emits) + PCM payload.
    const dataBytes = samples.length * 2;
    const buf = Buffer.alloc(44 + dataBytes);
    buf.write('RIFF', 0);
    buf.writeUInt32LE(36 + dataBytes, 4);
    buf.write('WAVE', 8);
    buf.write('fmt ', 12);
    buf.writeUInt32LE(16, 16); // PCM chunk size
    buf.writeUInt16LE(1, 20);  // PCM format
    buf.writeUInt16LE(1, 22);  // mono
    buf.writeUInt32LE(sampleRate, 24);
    buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
    buf.writeUInt16LE(2, 32);  // block align
    buf.writeUInt16LE(16, 34); // bits/sample
    buf.write('data', 36);
    buf.writeUInt32LE(dataBytes, 40);
    for (let i = 0; i < samples.length; i++) buf.writeInt16LE(samples[i]!, 44 + i * 2);
    return buf;
  }

  it('reads PCM int16 samples and normalizes to Float32 in [-1, 1)', () => {
    const wav = makeWav([0, 16384, -16384, 32767, -32768]);
    const { pcm, sampleRate } = __testOnly_readWavAsFloat32(wav);
    expect(sampleRate).toBe(16000);
    expect(pcm.length).toBe(5);
    expect(pcm[0]).toBeCloseTo(0, 5);
    expect(pcm[1]).toBeCloseTo(0.5, 4);
    expect(pcm[2]).toBeCloseTo(-0.5, 4);
    expect(pcm[3]).toBeCloseTo(0.99997, 4);
    expect(pcm[4]).toBeCloseTo(-1, 5);
  });

  it('throws on non-RIFF header', () => {
    const buf = Buffer.alloc(44);
    buf.write('XXXX', 0);
    expect(() => __testOnly_readWavAsFloat32(buf)).toThrow(/RIFF/);
  });

  it('throws when header is not 44 bytes (data chunk not at byte 36)', () => {
    const buf = Buffer.alloc(60);
    buf.write('RIFF', 0);
    buf.write('WAVE', 8);
    // No `data` magic at offset 36 → caller must regenerate with the bitexact ffmpeg script.
    expect(() => __testOnly_readWavAsFloat32(buf)).toThrow(/44 bytes/);
  });

  it('reads sampleRate from the header (not hard-coded)', () => {
    const wav = makeWav([0], 48000);
    expect(__testOnly_readWavAsFloat32(wav).sampleRate).toBe(48000);
  });
});
