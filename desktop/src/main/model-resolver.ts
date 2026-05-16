/**
 * Step 5 §5.1 — first-run model resolver.
 *
 * Pure functions: validateModelFile, serializeWrite, load/save/resolve below.
 * IPC binding: registerModelIpc (added in a later commit).
 *
 * Mirrors the ipc.ts pattern — pure exports + a register* entry point in the
 * same module so tests drive pure fns without Electron lifecycle.
 */

import { promises as fs } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import type { ModelSlot } from '@shared/ipc-protocol';
import { log, redactPath } from './log';

// --- Magic bytes ---
const STT_MAGIC_LMGG = Buffer.from([0x6c, 0x6d, 0x67, 0x67]);  // 'lmgg'
const STT_MAGIC_TJGG = Buffer.from([0x74, 0x6a, 0x67, 0x67]);  // 'tjgg' (legacy quantized variant)
const LLM_MAGIC_GGUF = Buffer.from([0x47, 0x47, 0x55, 0x46]);  // 'GGUF'

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: 'wrong-format' | 'unreadable' };

export async function validateModelFile(filePath: string, slot: ModelSlot): Promise<ValidationResult> {
  let fd: FileHandle | null = null;
  try {
    fd = await fs.open(filePath, 'r');
    const buf = Buffer.alloc(4);
    const { bytesRead } = await fd.read(buf, 0, 4, 0);
    if (bytesRead < 4) return { ok: false, reason: 'unreadable' };
    if (slot === 'stt') {
      const isGgml = buf.equals(STT_MAGIC_LMGG) || buf.equals(STT_MAGIC_TJGG);
      return isGgml ? { ok: true } : { ok: false, reason: 'wrong-format' };
    }
    return buf.equals(LLM_MAGIC_GGUF) ? { ok: true } : { ok: false, reason: 'wrong-format' };
  } catch (err) {
    log.error('[model-resolver] validation failed', redactPath(filePath), err);
    return { ok: false, reason: 'unreadable' };
  } finally {
    if (fd) await fd.close().catch(() => {});  // best-effort; no throw-during-throw
  }
}

// --- Concurrent-write serialization ---
//
// All disk writes to models.json funnel through this single Promise chain.
// Sequential UX (Step 1 → Step 2) makes user-initiated concurrency unlikely
// in practice, but the guard is cheap and protects against double-click
// race or any future code path that triggers two writes in flight.
let _writeChain: Promise<unknown> = Promise.resolve();

export function serializeWrite<T>(fn: () => Promise<T>): Promise<T> {
  const next = _writeChain.then(fn, fn);  // run fn whether previous resolved or rejected
  _writeChain = next.then(() => undefined, () => undefined);
  return next;
}

// --- Persistence ---

export interface ModelsJson {
  version: 1;
  sttPath: string;
  llmPath: string;
}

/**
 * Read <userData>/models.json. Returns null on:
 *   - missing file
 *   - malformed JSON
 *   - schema mismatch (version !== 1, or path fields not strings)
 *
 * Side effect: on every call, deletes <userData>/models.json.tmp if present
 * (crash-recovery — the atomic-write contract guarantees models.json itself
 * is never partial; the .tmp is discardable).
 */
export async function loadModelsJson(dir: string): Promise<ModelsJson | null> {
  const final = path.join(dir, 'models.json');
  const tmp = path.join(dir, 'models.json.tmp');

  // 1. Orphan-tmp recovery (idempotent — ignores ENOENT).
  await fs.unlink(tmp).catch(() => {});

  // 2. Read + parse + sanity-check.
  try {
    const raw = await fs.readFile(final, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const p = parsed as { version?: unknown; sttPath?: unknown; llmPath?: unknown };
    if (p.version !== 1) return null;
    if (typeof p.sttPath !== 'string' || typeof p.llmPath !== 'string') return null;
    return { version: 1, sttPath: p.sttPath, llmPath: p.llmPath };
  } catch {
    return null;
  }
}

/**
 * Atomic write of <userData>/models.json. Wrapped in serializeWrite so
 * concurrent invocations queue rather than race.
 *
 * Sequence (macOS APFS-safe):
 *   1. write tmp + fsync file fd
 *   2. rename tmp → final (POSIX-atomic on same filesystem)
 *   3. fsync directory entry (APFS reorders metadata otherwise)
 */
export function saveModelsJson(dir: string, content: ModelsJson): Promise<void> {
  return serializeWrite(async () => {
    const final = path.join(dir, 'models.json');
    const tmp = path.join(dir, 'models.json.tmp');
    const data = Buffer.from(JSON.stringify(content, null, 2));

    const fileFd = await fs.open(tmp, 'w');
    try {
      await fileFd.write(data, 0, data.length, 0);
      await fileFd.sync();
    } finally {
      await fileFd.close();
    }

    await fs.rename(tmp, final);

    // Dir fsync: Node's fs.promises.open on a directory yields a read-fd
    // whose FileHandle.sync() invokes fsync(2) on the dir fd. Verified
    // working on macOS 14 (Darwin 23.x). One test pins this in the suite.
    const dirFd = await fs.open(dir, 'r');
    try { await dirFd.sync(); } finally { await dirFd.close(); }
  });
}
