import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeDumpTitle, readDumpTitle, saveDumpTitle, MAX_DUMP_TITLE_LEN } from './dump-title';

const ID = '2026-06-11T03-00-00-000Z';
let base: string;

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'lisna-title-'));
  fs.mkdirSync(path.join(base, ID));
});
afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

describe('normalizeDumpTitle', () => {
  it('trims + collapses internal whitespace', () => {
    expect(normalizeDumpTitle('  hello   world  ')).toBe('hello world');
  });
  it('caps at MAX_DUMP_TITLE_LEN', () => {
    expect(normalizeDumpTitle('a'.repeat(MAX_DUMP_TITLE_LEN + 10)).length).toBe(MAX_DUMP_TITLE_LEN);
  });
  it('empty / whitespace-only → ""', () => {
    expect(normalizeDumpTitle('   ')).toBe('');
    expect(normalizeDumpTitle('')).toBe('');
  });
});

describe('readDumpTitle / saveDumpTitle', () => {
  it('returns null when no title.json exists', () => {
    expect(readDumpTitle(base, ID)).toBeNull();
  });

  it('persists and reads back a normalized title', async () => {
    await saveDumpTitle(base, ID, '  第3四半期レビュー  ');
    expect(readDumpTitle(base, ID)).toBe('第3四半期レビュー');
  });

  it('clears the title (removes title.json) when saved empty', async () => {
    await saveDumpTitle(base, ID, 'x');
    expect(readDumpTitle(base, ID)).toBe('x');
    await saveDumpTitle(base, ID, '   ');
    expect(readDumpTitle(base, ID)).toBeNull();
    expect(fs.existsSync(path.join(base, ID, 'title.json'))).toBe(false);
  });

  it('returns null for a malformed title.json (best-effort)', () => {
    fs.writeFileSync(path.join(base, ID, 'title.json'), '{not json');
    expect(readDumpTitle(base, ID)).toBeNull();
  });

  it('rejects an id that escapes the sessions dir (path-traversal guard)', async () => {
    await expect(saveDumpTitle(base, '../evil', 'x')).rejects.toThrow('INVALID_DUMP_ID');
  });
});
