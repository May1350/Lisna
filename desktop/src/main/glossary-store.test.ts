import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { loadGlossary, saveGlossary } from './glossary-store';

let dir: string;
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lisna-gloss-')); });
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

describe('glossary-store', () => {
  it('save → load round-trips the normalized list', async () => {
    const written = await saveGlossary(dir, ['カスタマーループ', '田中', 'SendGrid']);
    expect(written).toEqual(['カスタマーループ', '田中', 'SendGrid']);
    expect(await loadGlossary(dir)).toEqual(['カスタマーループ', '田中', 'SendGrid']);
  });

  it('save returns the normalized list (trim + dedupe)', async () => {
    const written = await saveGlossary(dir, ['  A ', 'A', 'B', '', '   ']);
    expect(written).toEqual(['A', 'B']);
  });

  it('missing file → []', async () => {
    expect(await loadGlossary(dir)).toEqual([]);
  });

  it('corrupt file → [] (fail-soft, no throw)', async () => {
    await fs.writeFile(path.join(dir, 'glossary.json'), '{not json', 'utf8');
    expect(await loadGlossary(dir)).toEqual([]);
  });

  it('non-array json → [] (parseGlossary guards shape)', async () => {
    await fs.writeFile(path.join(dir, 'glossary.json'), '{"a":1}', 'utf8');
    expect(await loadGlossary(dir)).toEqual([]);
  });

  it('unlinks an orphan glossary.json.tmp on load', async () => {
    await fs.writeFile(path.join(dir, 'glossary.json.tmp'), 'junk', 'utf8');
    await loadGlossary(dir);
    await expect(fs.access(path.join(dir, 'glossary.json.tmp'))).rejects.toThrow();
  });
});
