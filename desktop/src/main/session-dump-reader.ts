/**
 * Read-side of the #113 finalize debug dumps — powers the F2 history viewer
 * (spec 2026-06-12-v2-history-viewer-design section 3).
 *
 * Electron-free (baseDir injected) like session-debug-dump.ts, so unit tests
 * run on plain tmp dirs. This module owns NO writes — the viewer must never
 * mutate dumps (P0-1: regen runs don't write dumps either).
 */
import fs from 'node:fs';
import path from 'node:path';
import type { DumpSummary, DumpTranscript } from '@shared/ipc-protocol';
import { DUMP_DIR_RE } from './session-debug-dump';

/** `2026-06-11T03-00-00-000Z(-N)` → ISO `2026-06-11T03:00:00.000Z`. */
function recordedAtFromId(id: string): string {
  const stamp = id.replace(/Z-\d+$/, 'Z');
  return stamp.replace(
    /^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,
    '$1:$2:$3.$4Z',
  );
}

/**
 * Traversal guard (review P1-2): id must match the dump dir shape AND the
 * realpath-resolved target's PARENT must equal the realpath of baseDir —
 * resolve-and-compare equality, not string prefix. Throws INVALID_DUMP_ID.
 * Returns the resolved dump dir path.
 */
export function resolveDumpDir(baseDir: string, id: string): string {
  if (!DUMP_DIR_RE.test(id)) throw new Error('INVALID_DUMP_ID');
  const dir = path.join(baseDir, id);
  if (!fs.existsSync(dir)) throw new Error('DUMP_NOT_FOUND');
  let real: string;
  try {
    real = fs.realpathSync(dir);
    if (path.dirname(real) !== fs.realpathSync(baseDir)) {
      throw new Error('INVALID_DUMP_ID');
    }
  } catch (e) {
    if (e instanceof Error && e.message === 'INVALID_DUMP_ID') throw e;
    // dir vanished (concurrent newest-20 prune) or became unreadable between
    // existsSync and realpath — keep the documented error contract; never
    // leak a raw ENOENT/EACCES (absolute path) across the IPC boundary.
    throw new Error(
      (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'DUMP_NOT_FOUND' : 'DUMP_UNREADABLE',
    );
  }
  return real;
}

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Newest-first summaries of every dump dir under baseDir. Never throws. */
export function listDumps(baseDir: string): DumpSummary[] {
  let names: string[];
  try {
    names = fs
      .readdirSync(baseDir, { withFileTypes: true })
      // symlinks excluded: isDirectory() is lstat-based — loadDumpTranscript's
      // realpath guard is the load-time backstop
      .filter((e) => e.isDirectory() && DUMP_DIR_RE.test(e.name))
      .map((e) => e.name)
      .sort()
      .reverse(); // timestamp names sort chronologically → reverse = newest first
  } catch {
    return []; // base dir missing = no history yet
  }
  return names.map((id) => {
    const summary: DumpSummary = { id, recordedAt: recordedAtFromId(id) };
    try {
      const t = readJson(path.join(baseDir, id, 'transcript.json')) as DumpTranscript;
      summary.language = t.language;
      summary.llmModel = t.llmModel;
      summary.segmentCount = t.segmentCount ?? t.segments.length;
      summary.durationSec = t.durationSec ?? t.segments.at(-1)?.endSec ?? 0;
    } catch {
      summary.unreadable = true;
      return summary;
    }
    try {
      const r = readJson(path.join(baseDir, id, 'result.json')) as {
        ok?: boolean;
        family?: string;
      };
      summary.family = r.family;
      summary.ok = r.ok;
    } catch {
      // result.json absent (finalize crashed before settle) — list it anyway.
    }
    return summary;
  });
}

/** Full transcript payload of one dump. Throws INVALID_DUMP_ID / DUMP_NOT_FOUND / DUMP_UNREADABLE. */
export function loadDumpTranscript(baseDir: string, id: string): DumpTranscript {
  const dir = resolveDumpDir(baseDir, id);
  try {
    return readJson(path.join(dir, 'transcript.json')) as DumpTranscript;
  } catch {
    throw new Error('DUMP_UNREADABLE');
  }
}
