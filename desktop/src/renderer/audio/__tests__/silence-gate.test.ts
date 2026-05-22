import { describe, it, expect } from 'vitest';
import { rmsDbfs, isSilent, DEFAULT_SILENCE_THRESHOLD_DBFS } from '../silence-gate';

describe('rmsDbfs', () => {
  it('returns -Infinity for empty array', () => {
    expect(rmsDbfs(new Float32Array(0))).toBe(-Infinity);
  });

  it('returns -Infinity for all-zero buffer', () => {
    expect(rmsDbfs(new Float32Array(1000))).toBe(-Infinity);
  });

  it('returns exactly -60 dBFS for constant 0.001 amplitude', () => {
    // RMS of a constant signal equals its absolute value: 0.001
    // dBFS = 20 * log10(0.001) = -60 (exact)
    const buf = new Float32Array(1000);
    buf.fill(0.001);
    expect(rmsDbfs(buf)).toBeCloseTo(-60, 5);
  });

  it('returns exactly -40 dBFS for constant 0.01 amplitude', () => {
    const buf = new Float32Array(1000);
    buf.fill(0.01);
    expect(rmsDbfs(buf)).toBeCloseTo(-40, 5);
  });

  it('returns ~-6.0206 dBFS for constant 0.5 amplitude', () => {
    // 20 * log10(0.5) = -6.0205999...
    const buf = new Float32Array(1000);
    buf.fill(0.5);
    expect(rmsDbfs(buf)).toBeCloseTo(-6.0206, 3);
  });

  it('handles negative amplitudes (RMS is sign-agnostic)', () => {
    const buf = new Float32Array(1000);
    buf.fill(-0.01);
    expect(rmsDbfs(buf)).toBeCloseTo(-40, 5);
  });
});

describe('isSilent', () => {
  it('treats empty buffer as silent', () => {
    expect(isSilent(new Float32Array(0))).toBe(true);
  });

  it('treats all-zero buffer as silent at default threshold', () => {
    expect(isSilent(new Float32Array(1000))).toBe(true);
  });

  it('treats -60 dBFS signal as silent at default -50 threshold', () => {
    const buf = new Float32Array(1000);
    buf.fill(0.001);  // -60 dBFS < -50 → silent
    expect(isSilent(buf)).toBe(true);
  });

  it('treats -40 dBFS signal as NOT silent at default -50 threshold', () => {
    const buf = new Float32Array(1000);
    buf.fill(0.01);   // -40 dBFS > -50 → not silent
    expect(isSilent(buf)).toBe(false);
  });

  it('respects custom higher (more lenient) threshold', () => {
    // -60 dBFS signal vs -70 dBFS threshold → -60 > -70 → not silent
    const buf = new Float32Array(1000);
    buf.fill(0.001);
    expect(isSilent(buf, -70)).toBe(false);
  });

  it('respects custom lower (more aggressive) threshold', () => {
    // -6 dBFS signal vs -3 dBFS threshold → -6 < -3 → silent
    const buf = new Float32Array(1000);
    buf.fill(0.5);
    expect(isSilent(buf, -3)).toBe(true);
  });

  it('exports DEFAULT_SILENCE_THRESHOLD_DBFS = -50', () => {
    expect(DEFAULT_SILENCE_THRESHOLD_DBFS).toBe(-50);
  });
});
