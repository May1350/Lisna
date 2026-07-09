/**
 * B3 (M15) — persist a SUCCESSFUL cloud (Claude) from-dump regen back into its
 * SOURCE dump dir. A History regen with target 'claude' is PAID (the user's
 * own API key); before this, the regenerated note lived only in the renderer's
 * BackgroundJob — navigating away meant re-billing to see it again. The live
 * cloud path already persists via the settle's `_activeDump.writeResult`; this
 * covers the from-dump leg, which deliberately creates NO new dump (P0-1).
 *
 * On-device from-dump regens stay NON-persisting on purpose (free — the P0-1
 * parity decision stands); the caller (session-finalize.ts) invokes this only
 * on the cloud from-dump success branch.
 *
 * Write discipline:
 *   - id re-validated via resolveDumpDir (same traversal guard as dump-title).
 *   - note.json FIRST, then result.json — if the note write fails, result.json
 *     is untouched, so `ok:true` can never point at a stale/absent note.
 *   - each write is individually atomic (tmp + rename + dir-fsync via
 *     atomicWriteJson — the same helper dump-title/transcript-edit use), so a
 *     crash mid-write can never corrupt the existing paid/previous files.
 *   - result.json shape mirrors SessionDumpImpl.writeResult's success record
 *     ({ ok, family, finishedAt }) so listDumps/readers see one shape.
 *
 * THROWS on failure (reader-guard codes or fs errors) — the ipc.ts wiring
 * wraps it best-effort (a persist failure must never fail the already-billed
 * generation), matching session-debug-dump's "a dump failure must never break
 * a finalize" contract.
 */
import { resolveDumpDir } from './session-dump-reader';
import { atomicWriteJson } from './atomic-json';

export async function persistDumpNote(
  baseDir: string,
  id: string,
  family: string,
  note: unknown,
): Promise<void> {
  const dir = resolveDumpDir(baseDir, id);
  await atomicWriteJson(dir, 'note.json', note);
  await atomicWriteJson(dir, 'result.json', {
    ok: true,
    family,
    finishedAt: new Date().toISOString(),
  });
}
