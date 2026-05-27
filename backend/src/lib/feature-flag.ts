import { createHash } from 'node:crypto';

export type FlagValue = 'off' | 'allowlist' | 'all';
export type FlagResult = { allowed: true } | { allowed: false; reason: 'MODEL_DOWNLOAD_NOT_YET_ENABLED' | 'NOT_IN_ALLOWLIST' | 'NOT_IN_ROLLOUT_BUCKET' };

export interface EvaluateInput {
  flag: FlagValue;
  rolloutPct: number;        // 0-100
  userId: string;            // users.id UUID
  userEmail: string;
  allowlistEmails: Set<string>;
}

/**
 * Stable per-user rollout bucket. SHA-256(userId) first 4 bytes as uint32,
 * modulo 100. bucket < pct → in cohort. Deterministic; no churn across
 * deploys.
 *
 * SHA-256 (not a faster non-crypto hash) because CodeQL's
 * js/weak-cryptographic-algorithm flags SHA-1 even for non-crypto uses
 * like bucketing — and a stdlib digest beats pulling in a new dep.
 */
export function inRolloutBucket(userId: string, pct: number): boolean {
  if (pct <= 0) return false;
  if (pct >= 100) return true;
  const h = createHash('sha256').update(userId).digest();
  const bucket = h.readUInt32BE(0) % 100;
  return bucket < pct;
}

export function evaluateModelDownloadFlag(input: EvaluateInput): FlagResult {
  if (input.flag === 'off') {
    return { allowed: false, reason: 'MODEL_DOWNLOAD_NOT_YET_ENABLED' };
  }
  if (input.flag === 'allowlist') {
    if (input.allowlistEmails.has(input.userEmail)) return { allowed: true };
    return { allowed: false, reason: 'NOT_IN_ALLOWLIST' };
  }
  // flag === 'all'
  if (inRolloutBucket(input.userId, input.rolloutPct)) return { allowed: true };
  return { allowed: false, reason: 'NOT_IN_ROLLOUT_BUCKET' };
}
