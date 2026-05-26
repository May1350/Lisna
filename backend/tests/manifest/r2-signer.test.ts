import { describe, it, expect } from 'vitest';
import { signR2GetUrl } from '../../src/lib/r2-signer.js';

describe('r2-signer', () => {
  const opts = {
    accessKeyId: 'TEST_KEY',
    secretAccessKey: 'TEST_SECRET',
    bucket: 'lisna-models-prod',
    endpoint: 'https://acct.r2.cloudflarestorage.com',
  };

  it('returns a presigned URL containing the bucket/object path', async () => {
    const url = await signR2GetUrl(opts, 'kotoba-whisper-v2.0/q5_0/whisper.bin', 3600);
    expect(url).toMatch(/^https:\/\/acct\.r2\.cloudflarestorage\.com\/lisna-models-prod\/kotoba-whisper-v2\.0\/q5_0\/whisper\.bin/);
    expect(url).toContain('X-Amz-Signature=');
    expect(url).toContain('X-Amz-Expires=3600');
  });

  it('clamps TTL to <= 7 days (AWS SigV4 limit)', async () => {
    const url = await signR2GetUrl(opts, 'foo.bin', 100_000_000); // 100M seconds = ~3 years
    const m = /X-Amz-Expires=(\d+)/.exec(url);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeLessThanOrEqual(604_800); // 7d
  });

  it('clamps TTL to >= 60 seconds (avoid impossibly short URLs)', async () => {
    const url = await signR2GetUrl(opts, 'foo.bin', 10);
    const m = /X-Amz-Expires=(\d+)/.exec(url);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(60);
  });
});
