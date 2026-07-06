import fs from 'node:fs';
import path from 'node:path';
import { resolveDumpDir } from './session-dump-reader';
import { atomicWriteJson } from './atomic-json';

/**
 * User-editable recording title, stored per-dump in `title.json` — deliberately
 * SEPARATE from `transcript.json` so renaming never touches the STT-owned
 * transcript (and vice-versa). Read is best-effort (missing/malformed → no
 * title); write is atomic and validates the id via `resolveDumpDir`.
 */
export const MAX_DUMP_TITLE_LEN = 80;

/** Trim, collapse internal whitespace to single spaces, cap length. Non-string
 *  or empty/whitespace-only input → ''. */
export function normalizeDumpTitle(raw: string): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_DUMP_TITLE_LEN);
}

/** The user title for a dump, or null when unset/unreadable. Never throws — the
 *  file is optional, a malformed one is ignored (not fatal). Trusted-id path
 *  (listDumps iterates validated dir names / loadDump resolves first). */
export function readDumpTitle(baseDir: string, id: string): string | null {
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(baseDir, id, 'title.json'), 'utf8'),
    ) as { title?: unknown };
    const t = typeof raw?.title === 'string' ? normalizeDumpTitle(raw.title) : '';
    return t.length > 0 ? t : null;
  } catch {
    return null;
  }
}

/**
 * Set — or clear, when the normalized title is empty — the user title for a
 * dump. Atomic. Validates the id via `resolveDumpDir` (throws INVALID_DUMP_ID /
 * DUMP_NOT_FOUND) so an untrusted renderer id can't escape the sessions dir.
 */
export async function saveDumpTitle(baseDir: string, id: string, rawTitle: string): Promise<void> {
  const dir = resolveDumpDir(baseDir, id);
  const title = normalizeDumpTitle(rawTitle);
  if (title.length === 0) {
    // Clear: remove title.json so the display falls back to note/date.
    try { fs.rmSync(path.join(dir, 'title.json'), { force: true }); } catch { /* already gone */ }
    return;
  }
  await atomicWriteJson(dir, 'title.json', { title });
}
