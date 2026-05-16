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
import { ipcMain, dialog, type BrowserWindow } from 'electron';
import type { ModelSlot, ResolveResult, ModelStatus, PickResult, ModelPickPayload } from '@shared/ipc-protocol';
import { CHANNELS } from './ipc';
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
 *
 * Concurrency contract: caller-side. Must be invoked only at resolver entry
 * (boot, before any saveModelsJson can run). The unconditional .tmp unlink
 * would race with an in-flight write otherwise. If a re-resolve path is added
 * later (settings "reload from disk", etc.), wrap that call in serializeWrite.
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
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') {
      // Missing file is the expected first-run path — no log noise.
      return null;
    }
    log.warn('[model-resolver] loadModelsJson: discarding unreadable/malformed file', redactPath(final), err);
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

// --- Resolution ---

export interface ResolveOptions {
  userDataDir: string;
  envOverride: {
    stt?: string;
    llm?: string;
  };
}

/**
 * Determine model paths for boot. Env-var override is authoritative when
 * set (dev workflow); does NOT fall back to models.json for a missing
 * env-var file (the dev intent — "use this exact path" — must be honored
 * even if it's broken; surface needs-setup so the picker can be used to
 * pick a real file, which then writes to models.json).
 *
 * For each slot:
 *   - env-var set: existence-check the env path. Pass → use. Fail → missing.
 *   - env-var unset: read sttPath/llmPath from models.json. Pass + file
 *     exists → use. Otherwise missing.
 */
export async function resolveModels(opts: ResolveOptions): Promise<ResolveResult> {
  const stored = await loadModelsJson(opts.userDataDir);

  const resolved = await Promise.all([
    resolveSlot('stt', opts.envOverride.stt, stored?.sttPath),
    resolveSlot('llm', opts.envOverride.llm, stored?.llmPath),
  ]);
  const [sttResult, llmResult] = resolved;

  const missing: ModelSlot[] = [];
  if (!sttResult.ok) missing.push('stt');
  if (!llmResult.ok) missing.push('llm');

  if (missing.length === 0 && sttResult.ok && llmResult.ok) {
    return { kind: 'ready', sttPath: sttResult.path, llmPath: llmResult.path };
  }
  return { kind: 'needs-setup', missing };
}

async function resolveSlot(
  slot: ModelSlot,
  envPath: string | undefined,
  storedPath: string | undefined,
): Promise<{ ok: true; path: string } | { ok: false }> {
  // 1. Env-var override authoritative.
  if (envPath) {
    try {
      await fs.access(envPath);
      return { ok: true, path: envPath };
    } catch {
      return { ok: false };
    }
  }
  // 2. Fall through to stored path.
  if (storedPath) {
    try {
      await fs.access(storedPath);
      return { ok: true, path: storedPath };
    } catch {
      return { ok: false };
    }
  }
  return { ok: false };
}

// --- IPC binding ---

export interface ModelIpcDeps {
  getMainWindow: () => BrowserWindow | undefined;
  initialStatus: ResolveResult;
  userDataDir: string;
}

/**
 * Register the two model-resolver IPC channels. Must be called BEFORE
 * createWindow() so the renderer's first useEffect can safely invoke
 * models/status without hitting "No handler registered" (spec §4.2).
 *
 * `models/pick` awaits saveModelsJson inside serializeWrite, then
 * constructs the PickResult — caller-side `await window.lisna.pickModel()`
 * resolves only after the write is durable on disk (spec Decision #13).
 */
export function registerModelIpc(deps: ModelIpcDeps): void {
  let current: ModelStatus = deps.initialStatus;

  ipcMain.handle(CHANNELS.modelStatus, async (): Promise<ModelStatus> => current);

  ipcMain.handle(CHANNELS.modelPick, async (_e, payload: ModelPickPayload): Promise<PickResult> => {
    const { slot } = payload;
    const win = deps.getMainWindow();
    if (!win) {
      log.error('[model-resolver] modelPick: no main window');
      return { ok: false, code: 'MODEL_READ_FAILED' };
    }

    // 1. Native file dialog (filter by extension per slot).
    const filterName = slot === 'stt' ? 'Whisper STT (.bin)' : 'Llama LLM (.gguf)';
    const ext = slot === 'stt' ? 'bin' : 'gguf';
    const dlg = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: filterName, extensions: [ext] }],
    });
    if (dlg.canceled || dlg.filePaths.length === 0) {
      return { ok: false, code: 'PICKER_CANCELLED' };
    }
    const pickedPath = dlg.filePaths[0]!;  // narrowed: length === 0 guard above

    // 2. Magic-byte validation.
    const validation = await validateModelFile(pickedPath, slot);
    if (!validation.ok) {
      const code: 'MODEL_READ_FAILED' | 'INVALID_MAGIC_BYTES_STT' | 'INVALID_MAGIC_BYTES_LLM' =
        validation.reason === 'unreadable'
          ? 'MODEL_READ_FAILED'
          : (slot === 'stt' ? 'INVALID_MAGIC_BYTES_STT' : 'INVALID_MAGIC_BYTES_LLM');
      return { ok: false, code };
    }

    // 3. Compute new paths BEFORE write. For the slot NOT being picked,
    //    recover the existing path from in-memory state (if ready) or from
    //    models.json on disk (if needs-setup). This preserves a previously-set
    //    valid path when the user is fixing only one missing slot (spec §5.2
    //    step 3: "retains the still-valid STT path internally for the eventual
    //    rewrite"). Without reading models.json, a partial pick in the
    //    needs-setup state would overwrite the surviving path with ''.
    const nextSttPath = slot === 'stt' ? pickedPath : await findStored(current, 'stt', deps.userDataDir);
    const nextLlmPath = slot === 'llm' ? pickedPath : await findStored(current, 'llm', deps.userDataDir);

    // 4. Await the atomic disk write (serialized in-module).
    //    Empty-string for the not-yet-picked slot is a deliberate sentinel:
    //    loadModelsJson + resolveModels treat '' as a non-existent file path
    //    (fs.access rejects), so the next boot correctly reports needs-setup
    //    for that slot. Schema typed as string keeps JSON parsing simple.
    await saveModelsJson(deps.userDataDir, {
      version: 1,
      sttPath: nextSttPath ?? '',
      llmPath: nextLlmPath ?? '',
    });

    // 5. Recompute status from on-disk state. If both paths now point to
    //    real files, ready; otherwise needs-setup with the still-missing slot(s).
    current = await resolveModels({
      userDataDir: deps.userDataDir,
      envOverride: {},  // post-pick reflects disk truth, not env overrides
    });
    return { ok: true, status: current };
  });
}

/**
 * Recover a model path for the slot NOT being actively picked.
 *
 * When the current status is `ready`, the path is in memory — return it
 * directly. When the status is `needs-setup`, the non-missing slot's path
 * must be read from models.json on disk (spec §5.2 step 3: "retains the
 * still-valid STT path internally for the eventual rewrite"). The plan's
 * original code returned `undefined` here, which would overwrite a valid
 * preserved path with '' — a data-loss bug.  This async implementation
 * matches the JSDoc intent: read models.json, pull the relevant path.
 *
 * Returns `undefined` when no path is stored (genuinely missing slot or
 * absent/malformed models.json); caller writes '' sentinel.
 */
async function findStored(status: ModelStatus, slot: ModelSlot, userDataDir: string): Promise<string | undefined> {
  if (status.kind === 'ready') {
    return slot === 'stt' ? status.sttPath : status.llmPath;
  }
  // needs-setup: the slot that is NOT in `missing` may still have a valid
  // path persisted in models.json. Load and return it so the pick handler
  // can preserve it in the rewrite.
  const stored = await loadModelsJson(userDataDir);
  if (!stored) return undefined;
  const candidate = slot === 'stt' ? stored.sttPath : stored.llmPath;
  return candidate || undefined;  // '' is sentinel for missing — treat as absent
}
