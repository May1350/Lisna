import fs from 'node:fs';
import path from 'node:path';
import { resolveDumpDir } from './session-dump-reader';
import { atomicWriteJson } from './atomic-json';

export interface EditedSegment { startSec: number; endSec: number; text: string }

/**
 * Persist edited segment TEXT into a dump's `transcript.json` (atomic). The
 * write-side counterpart to the read-only session-dump-reader, kept separate so
 * the viewer module stays write-free.
 *
 * - `id` is validated by `resolveDumpDir` (dump-id shape + realpath-parent
 *   equality → rejects path traversal AND symlink escape; throws
 *   INVALID_DUMP_ID / DUMP_NOT_FOUND / DUMP_UNREADABLE).
 * - Edited text is merged into the RE-READ segments BY INDEX, so passthrough
 *   fields (e.g. `noSpeechProb`) survive. Timestamps + segment count are never
 *   changed (the UI edits text only).
 */
export async function saveTranscriptEdit(baseDir: string, id: string, edited: EditedSegment[]): Promise<void> {
  if (typeof id !== 'string') throw new Error('INVALID_DUMP_ID');
  const dir = resolveDumpDir(baseDir, id);
  const file = path.join(dir, 'transcript.json');

  let current: Record<string, unknown> & { segments?: unknown };
  try {
    current = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch (e) {
    throw new Error((e as NodeJS.ErrnoException).code === 'ENOENT' ? 'DUMP_NOT_FOUND' : 'DUMP_UNREADABLE');
  }
  if (!Array.isArray(current.segments)) throw new Error('DUMP_UNREADABLE');

  const merged = (current.segments as Array<Record<string, unknown>>).map((seg, i) => {
    const e = edited[i];
    return e && typeof e.text === 'string' ? { ...seg, text: e.text } : seg;
  });

  await atomicWriteJson(dir, 'transcript.json', { ...current, segments: merged, segmentCount: merged.length });
}
