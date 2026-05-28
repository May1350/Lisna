export interface RetryHistogram {
  samples: number;
  attemptsMean: number;
  attemptsByBin: Record<string, number>;
}

// Bin strategy:
//   • If any attempt ≥ 4 (overflow), use {1, 2, '3+'} where '3+' counts all attempts ≥ 3.
//   • Otherwise use {1, 2, 3} with explicit zero counts.
// This matches Spike 0.1 baseline shape ({1:4,2:1,3:0}) and merges overflow cleanly.
export function buildRetryHistogram(attempts: number[]): RetryHistogram {
  if (attempts.length === 0) return { samples: 0, attemptsMean: 0, attemptsByBin: {} };
  let n1 = 0, n2 = 0, n3 = 0, overflow = 0;
  let sum = 0;
  for (const a of attempts) {
    sum += a;
    if (a === 1) n1++;
    else if (a === 2) n2++;
    else if (a === 3) n3++;
    else overflow++;
  }
  const byBin: Record<string, number> = overflow > 0
    ? { '1': n1, '2': n2, '3+': n3 + overflow }
    : { '1': n1, '2': n2, '3': n3 };
  return {
    samples: attempts.length,
    attemptsMean: round2(sum / attempts.length),
    attemptsByBin: byBin,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
