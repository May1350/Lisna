import { it, expect } from 'vitest';
import { convolve, addNoiseAtSnr, measureSnrDb } from './degrade';

it('convolution with a unit impulse returns the signal unchanged', () => {
  const x = Float32Array.from([1, 2, 3]);
  const y = convolve(x, Float32Array.from([1]));
  expect(Array.from(y.slice(0, 3))).toEqual([1, 2, 3]);
});

it('convolution with [0,1] delays the signal by one sample', () => {
  const y = convolve(Float32Array.from([1, 2, 3]), Float32Array.from([0, 1]));
  expect(Array.from(y.slice(0, 4))).toEqual([0, 1, 2, 3]);
});

it('addNoiseAtSnr produces approximately the target SNR', () => {
  const sig = Float32Array.from({ length: 4000 }, (_, i) => Math.sin(i / 5));
  const noise = Float32Array.from({ length: 4000 }, (_, i) => Math.sin(i * 1.3 + 1)); // deterministic, no RNG
  const { mixed } = addNoiseAtSnr(sig, noise, 10);
  expect(measureSnrDb(sig, Float32Array.from(mixed, (v, i) => v - sig[i]))).toBeCloseTo(10, 0);
});
