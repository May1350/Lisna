import * as fs from 'node:fs/promises';
import * as path from 'node:path';

// Per-file write serialization: concurrent writes to the SAME path queue;
// different paths run independently. Decoupled from model-resolver's module
// `serializeWrite` global on purpose (glossary/transcript writes must not
// couple to model-pick writes).
const chains = new Map<string, Promise<unknown>>();
function serialize<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn); // run regardless of the prior write's outcome
  const guarded = next.catch(() => {});
  chains.set(key, guarded);
  // Drop the entry once settled (if still the tail) so the map doesn't grow
  // unbounded across many per-session transcript paths.
  void guarded.then(() => { if (chains.get(key) === guarded) chains.delete(key); });
  return next;
}

/**
 * Crash-safe atomic JSON write (macOS APFS-safe). Sequence:
 *   1. write `<filename>.tmp` + fsync the file fd
 *   2. rename tmp → final (POSIX-atomic on the same filesystem)
 *   3. fsync the directory fd (APFS reorders metadata otherwise)
 *
 * This is the same 4-step body as model-resolver's `saveModelsJson`, extracted
 * for the glossary + transcript stores. It is deliberately NOT shared WITH
 * `saveModelsJson`: that function also rides model-resolver's global
 * `serializeWrite` chain, which additionally guards `loadModelsJson`'s
 * unconditional `.tmp` unlink against an in-flight write — a contract specific
 * to that module. Keep them separate; the dir-fsync (step 3) is load-bearing on
 * APFS and must never be dropped (one test pins it here, as in model-resolver).
 */
export function atomicWriteJson(dir: string, filename: string, value: unknown): Promise<void> {
  const final = path.join(dir, filename);
  return serialize(final, async () => {
    const tmp = path.join(dir, `${filename}.tmp`);
    const data = Buffer.from(JSON.stringify(value, null, 2));

    const fileFd = await fs.open(tmp, 'w');
    try {
      await fileFd.write(data, 0, data.length, 0);
      await fileFd.sync();
    } finally {
      await fileFd.close();
    }

    await fs.rename(tmp, final);

    const dirFd = await fs.open(dir, 'r');
    try { await dirFd.sync(); } finally { await dirFd.close(); }
  });
}
