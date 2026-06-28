import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { atomicWriteJson } from './atomic-json';

let dir: string;
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lisna-atomic-')); });
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

describe('atomicWriteJson', () => {
  it('writes valid JSON that round-trips', async () => {
    await atomicWriteJson(dir, 'x.json', { a: 1, terms: ['t'] });
    const raw = await fs.readFile(path.join(dir, 'x.json'), 'utf8');
    expect(JSON.parse(raw)).toEqual({ a: 1, terms: ['t'] });
  });

  it('leaves no .tmp behind after a successful write', async () => {
    await atomicWriteJson(dir, 'x.json', { a: 1 });
    expect(await fs.readdir(dir)).toEqual(['x.json']);
  });

  it('serializes concurrent writes to the same path — final file is never corrupt', async () => {
    await Promise.all([1, 2, 3, 4, 5].map((n) => atomicWriteJson(dir, 'x.json', { n })));
    const raw = await fs.readFile(path.join(dir, 'x.json'), 'utf8');
    const parsed = JSON.parse(raw) as { n: number }; // throws if interleaved/partial
    expect([1, 2, 3, 4, 5]).toContain(parsed.n);
  });

  it('independent paths both land', async () => {
    await Promise.all([
      atomicWriteJson(dir, 'a.json', { a: true }),
      atomicWriteJson(dir, 'b.json', { b: true }),
    ]);
    expect(JSON.parse(await fs.readFile(path.join(dir, 'a.json'), 'utf8'))).toEqual({ a: true });
    expect(JSON.parse(await fs.readFile(path.join(dir, 'b.json'), 'utf8'))).toEqual({ b: true });
  });
});
