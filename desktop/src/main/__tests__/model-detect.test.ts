import { it, expect, vi } from 'vitest';
import { detectExistingModel } from '../model-detect';
import type { ModelDescriptor } from '@shared/types';

const D: ModelDescriptor = { kind: 'stt', filename: 'm.bin', sizeBytes: 100, sha256: 'goodhash', source: { url: 'x' } };

it('returns the userData path when size AND sha256 match', async () => {
  const sha = vi.fn(async () => 'goodhash');
  const p = await detectExistingModel(D, '/ud', { statSize: (x) => (x === '/ud/models/m.bin' ? 100 : null), sha256File: sha, extraCandidates: () => [] });
  expect(p).toBe('/ud/models/m.bin');
  expect(sha).toHaveBeenCalledOnce();
});

it('fast-rejects on size mismatch WITHOUT hashing', async () => {
  const sha = vi.fn(async () => 'goodhash');
  const p = await detectExistingModel(D, '/ud', { statSize: () => 999, sha256File: sha, extraCandidates: () => [] });
  expect(p).toBeNull();
  expect(sha).not.toHaveBeenCalled();
});

it('returns null when sha256 differs even if size matches', async () => {
  const p = await detectExistingModel(D, '/ud', { statSize: () => 100, sha256File: async () => 'wrong', extraCandidates: () => [] });
  expect(p).toBeNull();
});

it('returns null when the file is missing', async () => {
  const p = await detectExistingModel(D, '/ud', { statSize: () => null, sha256File: async () => 'goodhash', extraCandidates: () => [] });
  expect(p).toBeNull();
});

it('checks userData BEFORE extra candidates and returns the first valid match', async () => {
  const seen: string[] = [];
  const p = await detectExistingModel(D, '/ud', {
    statSize: (x) => { seen.push(x); return 100; },
    sha256File: async (x) => (x === '/prior/m.bin' ? 'goodhash' : 'no'),
    extraCandidates: () => ['/prior/m.bin'],
  });
  expect(seen[0]).toBe('/ud/models/m.bin');   // userData first
  expect(p).toBe('/prior/m.bin');
});
