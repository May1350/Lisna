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
