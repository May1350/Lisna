/** Direct (time-domain) convolution. The far-field IR here is SPARSE (a few
 *  early-reflection taps), so O(n·taps) is fine for clip-length signals.
 *  A dense measured RIR would want FFT overlap-add — out of scope for the
 *  synthetic lower-bound proxy (spec section 8: synthetic underestimates real). */
export function convolve(signal: Float32Array, ir: Float32Array): Float32Array {
  const out = new Float32Array(signal.length + ir.length - 1);
  for (let i = 0; i < ir.length; i++) {
    const c = ir[i];
    if (c === 0) continue;
    for (let n = 0; n < signal.length; n++) out[n + i] += c * signal[n];
  }
  return out;
}

function rms(x: Float32Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, x.length));
}

/** SNR in dB of `signal` against `noise` (both same-domain amplitude arrays). */
export function measureSnrDb(signal: Float32Array, noise: Float32Array): number {
  return 20 * Math.log10(rms(signal) / Math.max(1e-12, rms(noise)));
}

/** Scale `noise` so signal-to-noise = `snrDb`, return signal + scaled noise. */
export function addNoiseAtSnr(
  signal: Float32Array,
  noise: Float32Array,
  snrDb: number,
): { mixed: Float32Array; scale: number } {
  const target = rms(signal) / Math.pow(10, snrDb / 20);
  const scale = target / Math.max(1e-12, rms(noise));
  const mixed = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i++) mixed[i] = signal[i] + scale * noise[i % noise.length];
  return { mixed, scale };
}

/** Default sparse far-field IR: direct path + a few attenuated early
 *  reflections (taps in samples @16kHz: ~3ms, ~7ms, ~13ms), gains decaying.
 *  A real measured RIR can replace this for the spec's 'far-field-real'
 *  calibration condition. */
export function defaultFarFieldIr(): Float32Array {
  const ir = new Float32Array(220);
  ir[0] = 1.0;
  ir[48] = 0.5;
  ir[112] = 0.3;
  ir[208] = 0.18;
  return ir;
}

export function degradeFarField(
  signal: Float32Array,
  opts: { ir?: Float32Array; noise: Float32Array; snrDb: number },
): Float32Array {
  const reverbed = convolve(signal, opts.ir ?? defaultFarFieldIr());
  return addNoiseAtSnr(reverbed, opts.noise, opts.snrDb).mixed;
}
