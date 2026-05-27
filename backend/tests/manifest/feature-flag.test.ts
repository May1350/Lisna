import { describe, it, expect } from 'vitest';
import { evaluateModelDownloadFlag, inRolloutBucket } from '../../src/lib/feature-flag.js';

describe('feature-flag', () => {
  describe('evaluateModelDownloadFlag', () => {
    it('returns "off" → blocked for any user', () => {
      const r = evaluateModelDownloadFlag({
        flag: 'off',
        rolloutPct: 100,
        userId: 'any-uuid',
        userEmail: 'a@b.c',
        allowlistEmails: new Set(['a@b.c']),
      });
      expect(r).toEqual({ allowed: false, reason: 'MODEL_DOWNLOAD_NOT_YET_ENABLED' });
    });

    it('returns "allowlist" + email match → allowed', () => {
      const r = evaluateModelDownloadFlag({
        flag: 'allowlist',
        rolloutPct: 0,
        userId: 'uuid',
        userEmail: 'alpha@lisna.jp',
        allowlistEmails: new Set(['alpha@lisna.jp']),
      });
      expect(r).toEqual({ allowed: true });
    });

    it('returns "allowlist" + email miss → blocked NOT_IN_ALLOWLIST', () => {
      const r = evaluateModelDownloadFlag({
        flag: 'allowlist',
        rolloutPct: 100,
        userId: 'uuid',
        userEmail: 'random@example.com',
        allowlistEmails: new Set(['alpha@lisna.jp']),
      });
      expect(r).toEqual({ allowed: false, reason: 'NOT_IN_ALLOWLIST' });
    });

    it('returns "all" + rolloutPct=0 → blocked for ANY user (gate closed)', () => {
      const r = evaluateModelDownloadFlag({
        flag: 'all',
        rolloutPct: 0,
        userId: 'any-uuid',
        userEmail: 'a@b.c',
        allowlistEmails: new Set(),
      });
      expect(r).toMatchObject({ allowed: false, reason: 'NOT_IN_ROLLOUT_BUCKET' });
    });

    it('returns "all" + rolloutPct=100 → allowed for any user', () => {
      const r = evaluateModelDownloadFlag({
        flag: 'all',
        rolloutPct: 100,
        userId: 'any-uuid',
        userEmail: 'a@b.c',
        allowlistEmails: new Set(),
      });
      expect(r).toEqual({ allowed: true });
    });
  });

  describe('inRolloutBucket', () => {
    it('returns true for pct=100', () => {
      expect(inRolloutBucket('any-uuid', 100)).toBe(true);
    });
    it('returns false for pct=0', () => {
      expect(inRolloutBucket('any-uuid', 0)).toBe(false);
    });
    it('is stable per userId', () => {
      const userId = '550e8400-e29b-41d4-a716-446655440000';
      expect(inRolloutBucket(userId, 50)).toBe(inRolloutBucket(userId, 50));
    });
    it('distributes uniformly across users (100 different uuids at pct=50 → ~30-70 true)', () => {
      const uuids = Array.from({ length: 100 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`);
      const trueCount = uuids.filter(u => inRolloutBucket(u, 50)).length;
      expect(trueCount).toBeGreaterThan(30);
      expect(trueCount).toBeLessThan(70);
    });
  });
});
