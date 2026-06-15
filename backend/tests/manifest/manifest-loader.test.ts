import { describe, it, expect, vi } from 'vitest';
import { loadAndSignManifest } from '../../src/lib/manifest-loader.js';

describe('manifest-loader', () => {
  const r2 = {
    accessKeyId: 'k', secretAccessKey: 's',
    bucket: 'lisna-models-prod',
    endpoint: 'https://test.r2.example',
  };

  it('replaces object_key with signed url and strips object_key from response', async () => {
    const signer = vi.fn().mockImplementation(async (_cfg, key, _ttl) =>
      `https://signed.r2.example/${key}?sig=X`,
    );
    const out = await loadAndSignManifest({ r2, urlTtlSec: 3600, signer });
    expect(out.manifest_version).toBe(1);
    expect(out.models).toHaveLength(2);
    for (const m of out.models) {
      expect(m).not.toHaveProperty('object_key');
      expect(m.url).toMatch(/^https:\/\/signed\.r2\.example\//);
    }
    expect(signer).toHaveBeenCalledTimes(2);
  });

  it('regenerates generated_at to current UTC ISO (with Z suffix)', async () => {
    const before = new Date().toISOString();
    const signer = vi.fn().mockResolvedValue('https://x');
    const out = await loadAndSignManifest({ r2, urlTtlSec: 3600, signer });
    const after = new Date().toISOString();
    expect(out.generated_at >= before && out.generated_at <= after).toBe(true);
    expect(out.generated_at).toMatch(/Z$/);
  });

  it('preserves manifest model fields verbatim (besides object_key→url swap)', async () => {
    const signer = vi.fn().mockResolvedValue('https://signed');
    const out = await loadAndSignManifest({ r2, urlTtlSec: 3600, signer });
    const stt = out.models.find(m => m.slot === 'stt');
    expect(stt?.id).toBe('large-v3-turbo-q5_0');
    expect(stt?.lang).toBe('multi');
    expect(stt?.license_id).toBe('mit');
    expect(stt?.tier).toBe('default');
  });
});
