export function rmsDbfs(samples: Float32Array): number {
  if (samples.length === 0) return -Infinity;
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i]!;
    sumSq += v * v;
  }
  const rms = Math.sqrt(sumSq / samples.length);
  if (rms === 0) return -Infinity;
  return 20 * Math.log10(rms);
}

export const DEFAULT_SILENCE_THRESHOLD_DBFS = -50;

export function isSilent(
  samples: Float32Array,
  thresholdDbfs: number = DEFAULT_SILENCE_THRESHOLD_DBFS,
): boolean {
  return rmsDbfs(samples) < thresholdDbfs;
}
