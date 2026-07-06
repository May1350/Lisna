import { it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { downloadModel } from '../model-downloader';
import type { ModelDescriptor } from '@shared/types';

const BODY = Buffer.from('hello-model-bytes');
const SHA = crypto.createHash('sha256').update(BODY).digest('hex');
function desc(over: Partial<ModelDescriptor> = {}): ModelDescriptor {
  return { kind: 'stt', filename: 'm.bin', sizeBytes: BODY.length, sha256: SHA, source: { url: 'https://x/m.bin' }, ...over };
}
// Minimal fetch stub: one-chunk stream body + ok/status.
function okFetch(body = BODY, status = 200): typeof fetch {
  return (async () => ({
    ok: status >= 200 && status < 300, status,
    body: { getReader: () => { let done = false; return { read: async () => done ? { done: true, value: undefined } : (done = true, { done: false, value: new Uint8Array(body) }) }; } },
    headers: new Map([['content-length', String(body.length)]]),
  })) as unknown as typeof fetch;
}
let base: string;
beforeEach(() => { base = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-')); });
afterEach(() => { fs.rmSync(base, { recursive: true, force: true }); });

it('downloads, verifies sha256, atomically writes final file (no .part left)', async () => {
  const seen: number[] = [];
  const p = await downloadModel(desc(), base, { fetchImpl: okFetch(), freeBytes: () => 10e9, onProgress: (x) => seen.push(x.received) });
  expect(p).toBe(path.join(base, 'm.bin'));
  expect(fs.readFileSync(p)).toEqual(BODY);
  expect(fs.existsSync(p + '.part')).toBe(false);
  expect(seen.at(-1)).toBe(BODY.length);
});
it('CHECKSUM_MISMATCH deletes .part and throws', async () => {
  await expect(downloadModel(desc({ sha256: 'deadbeef' }), base, { fetchImpl: okFetch(), freeBytes: () => 10e9 }))
    .rejects.toThrow('CHECKSUM_MISMATCH');
  expect(fs.readdirSync(base)).toEqual([]); // .part cleaned, no final
});
it('non-200 → NETWORK_FAILED', async () => {
  await expect(downloadModel(desc(), base, { fetchImpl: okFetch(BODY, 404), freeBytes: () => 10e9 }))
    .rejects.toThrow('NETWORK_FAILED');
});
it('INSUFFICIENT_DISK when free < size + margin', async () => {
  await expect(downloadModel(desc(), base, { fetchImpl: okFetch(), freeBytes: () => 1 }))
    .rejects.toThrow('INSUFFICIENT_DISK');
});
