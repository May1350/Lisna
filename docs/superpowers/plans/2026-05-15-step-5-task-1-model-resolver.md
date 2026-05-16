# §5.1 First-Run Model Resolver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-run setup flow that lets the user pick two model files (Whisper STT `.bin` + Llama LLM `.gguf`), validates each by magic-byte, persists paths atomically to `<userData>/models.json`, and re-prompts at boot for any missing file. Unblocks the v2.0 alpha distribution path.

**Architecture:** Single pure `desktop/src/main/model-resolver.ts` module (mirroring the `ipc.ts` co-located pattern) with three concerns: validation, persistence (atomic + `.tmp`-orphan recovery), and resolve (env-var override-aware). Two new IPC channels (`models/status`, `models/pick`) exposed via the existing `contextBridge.exposeInMainWorld('lisna', ...)` preload bridge. Renderer adds a full-screen `SetupView` route with a reusable `ModelPickerStep` component; `App.tsx`'s `View` discriminated union gains a `'booting'` kind (prevents Recording flash before initial `getModelStatus()` resolves) and a `'setup'` kind. Picker UX is sequential (STT step → LLM step → 300ms fade → auto-redirect to Recording) per founder decisions.

**Tech Stack:** TypeScript (strict), Electron main + preload + renderer (React), vitest. macOS-only (APFS atomic-rename + dir fsync).

**Spec reference:** [`docs/superpowers/specs/2026-05-15-step-5-task-1-model-resolver-design.md`](../specs/2026-05-15-step-5-task-1-model-resolver-design.md) (post-4-stage review). Every task below references the relevant spec sections — re-read those sections during implementation rather than restating them here.

---

## File structure overview

| Path | Action | Touched in task |
|---|---|---|
| `desktop/src/shared/ipc-protocol.ts` | Modify (append types) | 1 |
| `desktop/src/renderer/i18n/error-message-map.ts` | Modify (append codes + JA strings) | 1 |
| `desktop/src/renderer/i18n/__tests__/error-message-map.test.ts` | Modify (update expectedCodes array + test description) | 1 |
| `desktop/src/renderer/i18n/setup-strings.ts` | Create | 1 |
| `desktop/src/main/model-resolver.ts` | Create + append across tasks | 2, 3, 4, 5 |
| `desktop/src/main/__tests__/model-resolver.test.ts` | Create + append `describe` blocks | 2, 3, 4 |
| `desktop/src/main/ipc.ts` | Modify (extend CHANNELS, add shell/open-external handler) | 5, 8 |
| `desktop/src/preload/index.ts` | Modify (add bridge methods + declare global; add openExternal) | 6, 8 |
| `desktop/src/main/index.ts` | Modify (boot order — resolveModels → register-before-createWindow) | 7 |
| `desktop/src/renderer/components/ModelPickerStep.tsx` | Create | 8 |
| `desktop/src/renderer/routes/SetupView.tsx` | Create | 9 |
| `desktop/src/renderer/App.tsx` | Modify (View union + getModelStatus initial fetch) | 10 |
| `desktop/src/__tests__/setup-flow.smoke.test.ts` | Create | 11 |
| `desktop/docs/manual-verification.md` | Modify (append §5.1 manual flow) | 12 |

---

## Task 1: TS types + i18n codes + setup-strings (foundation)

**Spec refs:** §4.4 (types), §4.1 (file layout), §6.2 (strings + Discord URL guard), §9 (error codes), §10.2 (test update requirement)

**Files:**
- Modify: `desktop/src/shared/ipc-protocol.ts` (append types at end)
- Modify: `desktop/src/renderer/i18n/error-message-map.ts` (append 6 codes + JA strings)
- Modify: `desktop/src/renderer/i18n/__tests__/error-message-map.test.ts` (extend expectedCodes from 13 → 19; update test name)
- Create: `desktop/src/renderer/i18n/setup-strings.ts`

- [ ] **Step 1: Append types to `desktop/src/shared/ipc-protocol.ts`**

Append at end of file (after the existing `SessionErrorPayload` interface):

```typescript
// --- Step 5 §5.1 — first-run model resolver ---

export type ModelSlot = 'stt' | 'llm';

export type ModelStatus =
  | { kind: 'ready'; sttPath: string; llmPath: string }
  | { kind: 'needs-setup'; missing: ModelSlot[] };  // sorted: 'stt' before 'llm'

/** Internal alias for main/model-resolver.ts. Same shape as ModelStatus — named
 *  separately so resolver-internal types can evolve without a renderer break. */
export type ResolveResult = ModelStatus;

export type PickResult =
  | { ok: true; status: ModelStatus }
  | { ok: false;
      code:
        | 'INVALID_MAGIC_BYTES_STT'
        | 'INVALID_MAGIC_BYTES_LLM'
        | 'MODEL_READ_FAILED'
        | 'PICKER_CANCELLED';
    };

/** Sent over CHANNELS.modelPick. */
export interface ModelPickPayload {
  slot: ModelSlot;
}
```

- [ ] **Step 2: Append 6 new codes to `ALL_ERROR_CODES` in error-message-map.ts**

Find the closing `] as const;` of `ALL_ERROR_CODES` (currently line ~38). Insert before that line:

```typescript
  // Step 5 §5.1 — first-run model resolver
  'MODEL_FILE_MISSING_STT',
  'MODEL_FILE_MISSING_LLM',
  'INVALID_MAGIC_BYTES_STT',
  'INVALID_MAGIC_BYTES_LLM',
  'MODEL_READ_FAILED',
  'PICKER_CANCELLED',
```

- [ ] **Step 3: Append 6 new JA strings to `ERROR_MESSAGE_MAP_JA` in error-message-map.ts**

Find the closing `};` of `ERROR_MESSAGE_MAP_JA` (currently line ~80). Insert before that line:

```typescript
  MODEL_FILE_MISSING_STT:
    '文字起こしモデルのファイルが見つかりません。もう一度選択してください。',
  MODEL_FILE_MISSING_LLM:
    'ノート生成モデルのファイルが見つかりません。もう一度選択してください。',
  INVALID_MAGIC_BYTES_STT:
    'このファイルは文字起こしモデルとして読み込めませんでした。Discord で配布されたファイルを再度選択してください。',
  INVALID_MAGIC_BYTES_LLM:
    'このファイルはノート生成モデルとして読み込めませんでした。Discord で配布されたファイルを再度選択してください。',
  MODEL_READ_FAILED:
    'モデルファイルを読み込めませんでした。ファイルのアクセス権限をご確認ください。',
  PICKER_CANCELLED:
    '選択がキャンセルされました。続行するにはファイルを選択してください。',
```

- [ ] **Step 4: Update `expectedCodes` array in error-message-map.test.ts**

Find (line 11):
```typescript
  it('covers all 13 known codes from Step 5 §3.2 brief', () => {
```
Replace with:
```typescript
  it('covers all 19 known codes (Step 5 §3.2 + §5.1)', () => {
```

Find the `expectedCodes` array (lines 16-30). Append after `'GENERATE_TIMEOUT',`:
```typescript
      // Step 5 §5.1 — first-run model resolver
      'MODEL_FILE_MISSING_STT',
      'MODEL_FILE_MISSING_LLM',
      'INVALID_MAGIC_BYTES_STT',
      'INVALID_MAGIC_BYTES_LLM',
      'MODEL_READ_FAILED',
      'PICKER_CANCELLED',
```

Note: the `toHaveLength(expectedCodes.length)` assertion auto-follows the array. No separate length number to update.

- [ ] **Step 5: Run i18n test — confirm green**

Run from `desktop/`:
```bash
pnpm vitest run src/renderer/i18n/__tests__/error-message-map.test.ts
```
Expected: 10 tests pass (`coverage` + 4 style invariants + 4 toFriendlyJa cases + `SIDECAR_GAVE_UP` mention).

If failure: read the failing assertion, confirm a string violates polite-form / `。` / length-6 invariants. Correct the offending string in `ERROR_MESSAGE_MAP_JA`.

- [ ] **Step 6: Create `desktop/src/renderer/i18n/setup-strings.ts`**

```typescript
/**
 * Step 5 §5.1 — picker UI strings (JA-only for v2.0, polite desu/masu per ADR §3).
 * Tone matches `error-message-map.ts` — diagnosis + recovery clause, no Latin
 * model jargon in user-facing copy (uses founder's prod nouns 「文字起こしモデル」
 * / 「ノート生成モデル」 as established in STT_TIMEOUT / LLM_LOAD_TIMEOUT).
 */

export const SETUP_STRINGS_JA = {
  stepIndicator: (current: 1 | 2, total: 2): string => `ステップ ${current} / ${total}`,
  sttTitle: '文字起こしモデル (.bin) の選択',
  llmTitle: 'ノート生成モデル (.gguf) の選択',
  body: 'Discord #lisna-alpha チャンネルから届いたファイルを選択してください。',
  pickButton: 'ファイルを選択',
  discordButton: 'Discord で受け取る',
  ready: '準備が完了しました',
} as const;

/**
 * Discord deep-link. Founder fills <server>/<channel> before alpha merge.
 * If still placeholder, isDiscordUrlConfigured() returns false and the
 * picker UI hides the Discord button — prevents shipping a broken
 * shell.openExternal call to a hallucinated URL.
 */
export const DISCORD_CHANNEL_URL = 'https://discord.com/channels/<server>/<channel>';

export function isDiscordUrlConfigured(): boolean {
  return !DISCORD_CHANNEL_URL.includes('<');
}
```

- [ ] **Step 7: Run typecheck**

Run from `desktop/`:
```bash
pnpm typecheck
```
Expected: 0 errors. (No new code consumes these symbols yet; just type-checking the additions in isolation.)

- [ ] **Step 8: Commit**

```bash
git add desktop/src/shared/ipc-protocol.ts \
        desktop/src/renderer/i18n/error-message-map.ts \
        desktop/src/renderer/i18n/__tests__/error-message-map.test.ts \
        desktop/src/renderer/i18n/setup-strings.ts
git commit -m "$(cat <<'EOF'
feat(desktop): §5.1 types + i18n codes + setup-strings foundation

- ipc-protocol.ts: ModelSlot, ModelStatus, ResolveResult, PickResult,
  ModelPickPayload types
- error-message-map.ts: 6 new codes (MODEL_FILE_MISSING_STT/LLM,
  INVALID_MAGIC_BYTES_STT/LLM, MODEL_READ_FAILED, PICKER_CANCELLED) +
  JA strings (polite desu/masu + recovery clause, founder's existing
  prod nouns 「文字起こしモデル」/「ノート生成モデル」)
- error-message-map.test.ts: extend expectedCodes 13 → 19; update test name
- setup-strings.ts: picker UI strings + DISCORD_CHANNEL_URL constant +
  isDiscordUrlConfigured() runtime guard (hides Discord button if
  founder has not filled in real <server>/<channel> before alpha)

Spec: docs/superpowers/specs/2026-05-15-step-5-task-1-model-resolver-design.md
EOF
)"
```

---

## Task 2: validateModelFile + serializeWrite (pure helpers)

**Spec refs:** §7 (validation + serialization helpers)

**Files:**
- Create: `desktop/src/main/model-resolver.ts`
- Create: `desktop/src/main/__tests__/model-resolver.test.ts`

- [ ] **Step 1: Write failing tests first — create `desktop/src/main/__tests__/model-resolver.test.ts`**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateModelFile, serializeWrite } from '../model-resolver';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lisna-model-resolver-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function writeFixture(name: string, bytes: number[]): Promise<string> {
  const p = path.join(tmpDir, name);
  await fs.writeFile(p, Buffer.from(bytes));
  return p;
}

describe('validateModelFile', () => {
  it('STT slot accepts GGML magic lmgg', async () => {
    const p = await writeFixture('whisper-lmgg.bin', [0x6c, 0x6d, 0x67, 0x67, 0x00, 0x00]);
    expect(await validateModelFile(p, 'stt')).toEqual({ ok: true });
  });

  it('STT slot accepts GGML magic tjgg (quantized variant)', async () => {
    const p = await writeFixture('whisper-tjgg.bin', [0x74, 0x6a, 0x67, 0x67, 0x00, 0x00]);
    expect(await validateModelFile(p, 'stt')).toEqual({ ok: true });
  });

  it('STT slot rejects GGUF magic with wrong-format', async () => {
    const p = await writeFixture('llama.gguf', [0x47, 0x47, 0x55, 0x46, 0x00, 0x00]);
    expect(await validateModelFile(p, 'stt')).toEqual({ ok: false, reason: 'wrong-format' });
  });

  it('STT slot rejects truncated file (<4 bytes) with unreadable', async () => {
    const p = await writeFixture('tiny.bin', [0x6c, 0x6d]);
    expect(await validateModelFile(p, 'stt')).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('STT slot rejects missing path with unreadable', async () => {
    const result = await validateModelFile(path.join(tmpDir, 'does-not-exist'), 'stt');
    expect(result).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('LLM slot accepts GGUF magic', async () => {
    const p = await writeFixture('llama.gguf', [0x47, 0x47, 0x55, 0x46, 0x00, 0x00]);
    expect(await validateModelFile(p, 'llm')).toEqual({ ok: true });
  });

  it('LLM slot rejects GGML magic with wrong-format', async () => {
    const p = await writeFixture('whisper.bin', [0x6c, 0x6d, 0x67, 0x67, 0x00, 0x00]);
    expect(await validateModelFile(p, 'llm')).toEqual({ ok: false, reason: 'wrong-format' });
  });

  // Spec §10.1 row 6 — EACCES (permission denied). Skip on root since chmod
  // 0o000 has no effect for root and the test would falsely pass.
  it('STT slot rejects permission-denied file with unreadable (EACCES)', async () => {
    if (process.getuid?.() === 0) return;  // root — skip
    const p = await writeFixture('locked.bin', [0x6c, 0x6d, 0x67, 0x67]);
    await fs.chmod(p, 0o000);
    try {
      expect(await validateModelFile(p, 'stt')).toEqual({ ok: false, reason: 'unreadable' });
    } finally {
      await fs.chmod(p, 0o600);  // restore so afterEach rm can clean up
    }
  });
});

describe('serializeWrite', () => {
  it('runs operations in order even when scheduled concurrently', async () => {
    const order: number[] = [];
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    const p1 = serializeWrite(async () => { await sleep(20); order.push(1); return 1; });
    const p2 = serializeWrite(async () => { await sleep(5); order.push(2); return 2; });
    const p3 = serializeWrite(async () => { order.push(3); return 3; });

    expect(await Promise.all([p1, p2, p3])).toEqual([1, 2, 3]);
    expect(order).toEqual([1, 2, 3]);
  });

  it('continues the chain after a rejected operation', async () => {
    const order: string[] = [];
    const p1 = serializeWrite(async () => { order.push('a'); throw new Error('boom'); });
    const p2 = serializeWrite(async () => { order.push('b'); return 'b'; });
    await expect(p1).rejects.toThrow('boom');
    await expect(p2).resolves.toBe('b');
    expect(order).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL (module not found)**

```bash
pnpm vitest run src/main/__tests__/model-resolver.test.ts
```
Expected: All tests fail with "Cannot find module '../model-resolver'" or similar. (10 tests fail: 7 validate + 1 EACCES + 2 serializeWrite.)

- [ ] **Step 3: Create `desktop/src/main/model-resolver.ts` (validation + serializeWrite only)**

```typescript
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
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm vitest run src/main/__tests__/model-resolver.test.ts
```
Expected: 10 tests pass (7 validate + 1 EACCES + 2 serializeWrite). EACCES test self-skips if running as root.

- [ ] **Step 5: Run typecheck**

```bash
pnpm typecheck
```
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/main/model-resolver.ts desktop/src/main/__tests__/model-resolver.test.ts
git commit -m "$(cat <<'EOF'
feat(desktop): §5.1 validateModelFile + serializeWrite

- validateModelFile(path, slot): reads first 4 bytes of file via fs.open
  + read, compares against per-slot magic bytes (GGML lmgg/tjgg for STT,
  GGUF for LLM). Returns ok or {ok:false, reason:'wrong-format'|'unreadable'}.
  fd cleanup in finally, best-effort close (no throw-during-throw).
- serializeWrite<T>(fn): single in-module Promise chain. Concurrent
  saveModelsJson calls queue sequentially. Survives rejection (chain
  continues with next op).

Tests: 7 validate cases (lmgg/tjgg/GGUF mismatches, short file, missing)
+ 2 serializeWrite cases (order preserved, chain continues after reject).

Spec: §7
EOF
)"
```

---

## Task 3: loadModelsJson + saveModelsJson (persistence)

**Spec refs:** §8 (persistence schema + atomic write + .tmp orphan recovery)

**Files:**
- Modify: `desktop/src/main/model-resolver.ts` (append)
- Modify: `desktop/src/main/__tests__/model-resolver.test.ts` (append `describe('loadModelsJson')` + `describe('saveModelsJson')`)

- [ ] **Step 1: Append failing tests to model-resolver.test.ts**

Append below the existing `describe` blocks:

```typescript
import { loadModelsJson, saveModelsJson, type ModelsJson } from '../model-resolver';

describe('loadModelsJson', () => {
  it('returns null when models.json does not exist', async () => {
    expect(await loadModelsJson(tmpDir)).toBeNull();
  });

  it('returns parsed v1 content when file is valid', async () => {
    const content: ModelsJson = { version: 1, sttPath: '/abs/whisper.bin', llmPath: '/abs/llama.gguf' };
    await fs.writeFile(path.join(tmpDir, 'models.json'), JSON.stringify(content));
    expect(await loadModelsJson(tmpDir)).toEqual(content);
  });

  it('returns null on malformed JSON', async () => {
    await fs.writeFile(path.join(tmpDir, 'models.json'), '{ not valid');
    expect(await loadModelsJson(tmpDir)).toBeNull();
  });

  it('returns null on version mismatch (e.g. version: 2)', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'models.json'),
      JSON.stringify({ version: 2, sttPath: '/a', llmPath: '/b' }),
    );
    expect(await loadModelsJson(tmpDir)).toBeNull();
  });

  it('returns null when sttPath or llmPath is not a string', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'models.json'),
      JSON.stringify({ version: 1, sttPath: 123, llmPath: null }),
    );
    expect(await loadModelsJson(tmpDir)).toBeNull();
  });

  it('deletes orphan models.json.tmp on entry (crash recovery)', async () => {
    await fs.writeFile(path.join(tmpDir, 'models.json.tmp'), 'orphan content');
    await loadModelsJson(tmpDir);
    await expect(fs.stat(path.join(tmpDir, 'models.json.tmp'))).rejects.toThrow();
  });

  it('orphan-tmp deletion is idempotent — no error when tmp does not exist', async () => {
    // No tmp file present; should not throw.
    await expect(loadModelsJson(tmpDir)).resolves.toBeNull();
  });
});

describe('saveModelsJson', () => {
  it('writes models.json atomically and cleans up tmp', async () => {
    const content: ModelsJson = { version: 1, sttPath: '/abs/a.bin', llmPath: '/abs/b.gguf' };
    await saveModelsJson(tmpDir, content);
    const final = path.join(tmpDir, 'models.json');
    const tmp = path.join(tmpDir, 'models.json.tmp');
    const written = JSON.parse(await fs.readFile(final, 'utf8'));
    expect(written).toEqual(content);
    await expect(fs.stat(tmp)).rejects.toThrow();  // tmp gone after rename
  });

  it('survives a sequence of writes (serialized, last-writer-wins)', async () => {
    const a: ModelsJson = { version: 1, sttPath: '/a', llmPath: '/x' };
    const b: ModelsJson = { version: 1, sttPath: '/b', llmPath: '/y' };
    await Promise.all([saveModelsJson(tmpDir, a), saveModelsJson(tmpDir, b)]);
    const final = JSON.parse(await fs.readFile(path.join(tmpDir, 'models.json'), 'utf8'));
    expect(final).toEqual(b);  // last queued wins
  });

  it('directory fsync does not throw on macOS APFS (smoke)', async () => {
    // Pinning that fs.promises.open(dir, 'r') + FileHandle.sync() works
    // on the test runner's filesystem. If this fails on a future Node
    // version, replace the dir fsync with child_process.spawn('sync').
    await expect(
      saveModelsJson(tmpDir, { version: 1, sttPath: '/a', llmPath: '/b' }),
    ).resolves.toBeUndefined();
  });

  // Spec §10.1 row 18 — fsync rejection: file fsync throws → tmp persists,
  // no rename, error propagates to caller.
  it('propagates fsync rejection and leaves no models.json (tmp may persist)', async () => {
    const vitest = await import('vitest');
    const fsModule = await import('node:fs/promises');
    const realOpen = fsModule.open;
    const spy = vitest.vi.spyOn(fsModule, 'open').mockImplementation(async (...args: Parameters<typeof realOpen>) => {
      const handle = await realOpen(...args);
      // Rig fileFd.sync to reject the first time it's called. Subsequent
      // opens (e.g. directory open later) operate normally.
      const originalSync = handle.sync.bind(handle);
      let called = false;
      handle.sync = async () => {
        if (!called) {
          called = true;
          throw new Error('mock fsync failure');
        }
        return originalSync();
      };
      return handle;
    });
    try {
      await expect(
        saveModelsJson(tmpDir, { version: 1, sttPath: '/a', llmPath: '/b' }),
      ).rejects.toThrow('mock fsync failure');
      // models.json should NOT exist (rename never ran)
      await expect(fs.stat(path.join(tmpDir, 'models.json'))).rejects.toThrow();
    } finally {
      spy.mockRestore();
    }
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL (`loadModelsJson`, `saveModelsJson`, `ModelsJson` undefined)**

```bash
pnpm vitest run src/main/__tests__/model-resolver.test.ts
```
Expected: 11 new tests fail; original 10 still pass.

- [ ] **Step 3: Append persistence functions to `desktop/src/main/model-resolver.ts`**

Add `path` to the imports at the top:
```typescript
import path from 'node:path';
```

Append at end of file:
```typescript
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
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm vitest run src/main/__tests__/model-resolver.test.ts
```
Expected: 21 tests pass total (10 from Task 2 + 11 new).

- [ ] **Step 5: Run typecheck**

```bash
pnpm typecheck
```
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/main/model-resolver.ts desktop/src/main/__tests__/model-resolver.test.ts
git commit -m "$(cat <<'EOF'
feat(desktop): §5.1 loadModelsJson + saveModelsJson (atomic + APFS-safe)

- loadModelsJson(dir): reads models.json (v1 schema), returns null on
  missing/malformed/version-mismatch/bad-field-types. On every call
  deletes orphan models.json.tmp (crash recovery — atomic-write contract
  guarantees models.json itself is never partial).
- saveModelsJson(dir, content): serialized atomic write — tmp + fsync(file)
  → rename → fsync(dir). macOS APFS-safe (dir fsync prevents metadata
  reorder).

Tests: 7 load cases (missing/valid/malformed/version/types/orphan/idempotent)
+ 3 save cases (atomic, last-writer-wins on serialized concurrent calls,
dir-fsync smoke).

Spec: §8
EOF
)"
```

---

## Task 4: resolveModels (env-var override + missing detection)

**Spec refs:** §5.1, §5.2, §5.4 (data flow + env-var authoritative-no-fallback)

**Files:**
- Modify: `desktop/src/main/model-resolver.ts` (append)
- Modify: `desktop/src/main/__tests__/model-resolver.test.ts` (append `describe('resolveModels')`)

- [ ] **Step 1: Append failing tests to model-resolver.test.ts**

```typescript
import { resolveModels } from '../model-resolver';

describe('resolveModels', () => {
  it('returns needs-setup ["stt", "llm"] when no models.json exists', async () => {
    expect(await resolveModels({ userDataDir: tmpDir, envOverride: {} }))
      .toEqual({ kind: 'needs-setup', missing: ['stt', 'llm'] });
  });

  it('returns ready when models.json points to two real valid files', async () => {
    const stt = await writeFixture('w.bin', [0x6c, 0x6d, 0x67, 0x67]);
    const llm = await writeFixture('l.gguf', [0x47, 0x47, 0x55, 0x46]);
    await saveModelsJson(tmpDir, { version: 1, sttPath: stt, llmPath: llm });
    expect(await resolveModels({ userDataDir: tmpDir, envOverride: {} }))
      .toEqual({ kind: 'ready', sttPath: stt, llmPath: llm });
  });

  it('returns needs-setup ["stt"] when STT file is deleted between sessions', async () => {
    const llm = await writeFixture('l.gguf', [0x47, 0x47, 0x55, 0x46]);
    await saveModelsJson(tmpDir, {
      version: 1,
      sttPath: path.join(tmpDir, 'deleted-stt.bin'),
      llmPath: llm,
    });
    expect(await resolveModels({ userDataDir: tmpDir, envOverride: {} }))
      .toEqual({ kind: 'needs-setup', missing: ['stt'] });
  });

  it('returns needs-setup [both] when models.json is malformed', async () => {
    await fs.writeFile(path.join(tmpDir, 'models.json'), '{ broken json');
    expect(await resolveModels({ userDataDir: tmpDir, envOverride: {} }))
      .toEqual({ kind: 'needs-setup', missing: ['stt', 'llm'] });
  });

  it('env-var override wins when both vars set and files exist', async () => {
    const stt = await writeFixture('env-w.bin', [0x6c, 0x6d, 0x67, 0x67]);
    const llm = await writeFixture('env-l.gguf', [0x47, 0x47, 0x55, 0x46]);
    expect(await resolveModels({
      userDataDir: tmpDir,
      envOverride: { stt, llm },
    })).toEqual({ kind: 'ready', sttPath: stt, llmPath: llm });
  });

  it('env-var override is authoritative — does NOT fall back to models.json when env file missing', async () => {
    const realLlm = await writeFixture('l.gguf', [0x47, 0x47, 0x55, 0x46]);
    await saveModelsJson(tmpDir, {
      version: 1,
      sttPath: realLlm,  // bogus content but file exists
      llmPath: realLlm,
    });
    const result = await resolveModels({
      userDataDir: tmpDir,
      envOverride: { stt: path.join(tmpDir, 'does-not-exist.bin'), llm: realLlm },
    });
    expect(result).toEqual({ kind: 'needs-setup', missing: ['stt'] });
  });

  it('asymmetric override — only stt env set, llm reads from models.json', async () => {
    const stt = await writeFixture('env-w.bin', [0x6c, 0x6d, 0x67, 0x67]);
    const llm = await writeFixture('disk-l.gguf', [0x47, 0x47, 0x55, 0x46]);
    await saveModelsJson(tmpDir, { version: 1, sttPath: 'ignored', llmPath: llm });
    expect(await resolveModels({
      userDataDir: tmpDir,
      envOverride: { stt },
    })).toEqual({ kind: 'ready', sttPath: stt, llmPath: llm });
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL (`resolveModels` not defined)**

```bash
pnpm vitest run src/main/__tests__/model-resolver.test.ts
```
Expected: 7 new tests fail.

- [ ] **Step 3: Append `resolveModels` to model-resolver.ts**

```typescript
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
```

Also add the `ResolveResult` import — find the existing import line:
```typescript
import type { ModelSlot } from '@shared/ipc-protocol';
```
Change to:
```typescript
import type { ModelSlot, ResolveResult } from '@shared/ipc-protocol';
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm vitest run src/main/__tests__/model-resolver.test.ts
```
Expected: 26 tests pass total (19 prior + 7 new).

- [ ] **Step 5: Run typecheck**

```bash
pnpm typecheck
```
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/main/model-resolver.ts desktop/src/main/__tests__/model-resolver.test.ts
git commit -m "$(cat <<'EOF'
feat(desktop): §5.1 resolveModels (env-authoritative + missing detection)

- resolveModels({ userDataDir, envOverride }): for each of stt/llm, env-var
  wins when set (existence-checked, no fallback to models.json on env file
  missing — honors dev intent). Otherwise stored path from models.json.
- Asymmetric override supported (only one env var set).
- ResolveResult = ModelStatus shape — ready | needs-setup with sorted
  missing slots.

Tests: 7 scenarios — no models.json, valid models.json, stt-deleted,
malformed, env-wins, env-authoritative-no-fallback, asymmetric.

Spec: §5.1, §5.2, §5.4
EOF
)"
```

---

## Task 5: CHANNELS extension + registerModelIpc

**Spec refs:** §4.3 (CHANNELS), §4.4 (PickResult), §5.1 step 6-8 + §7 (handler await contract)

**Files:**
- Modify: `desktop/src/main/ipc.ts` (extend CHANNELS const only)
- Modify: `desktop/src/main/model-resolver.ts` (append `registerModelIpc`)

- [ ] **Step 1: Extend `CHANNELS` in `desktop/src/main/ipc.ts`**

Find `CHANNELS` (line 18). Add inside the object literal before the closing `} as const;`:

```typescript
  /** renderer → main: query current ModelStatus on App mount */
  modelStatus: 'models/status',
  /** renderer → main: native file dialog + magic-byte validate + atomic
   *  save for one slot. Handler awaits the disk write before returning,
   *  so PickResult.status reflects committed state (spec §5.1 step 7). */
  modelPick: 'models/pick',
```

- [ ] **Step 2: Append `registerModelIpc` to `desktop/src/main/model-resolver.ts`**

Add imports at top of file:
```typescript
import { ipcMain, dialog, type BrowserWindow } from 'electron';
import type { ModelStatus, PickResult, ModelPickPayload } from '@shared/ipc-protocol';
import { CHANNELS } from './ipc';
```

Append at end of file:
```typescript
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
    const pickedPath = dlg.filePaths[0];

    // 2. Magic-byte validation.
    const validation = await validateModelFile(pickedPath, slot);
    if (!validation.ok) {
      const code: 'MODEL_READ_FAILED' | 'INVALID_MAGIC_BYTES_STT' | 'INVALID_MAGIC_BYTES_LLM' =
        validation.reason === 'unreadable'
          ? 'MODEL_READ_FAILED'
          : (slot === 'stt' ? 'INVALID_MAGIC_BYTES_STT' : 'INVALID_MAGIC_BYTES_LLM');
      return { ok: false, code };
    }

    // 3. Compute new status BEFORE write so we can return it post-await.
    const nextSttPath = slot === 'stt' ? pickedPath : (current.kind === 'ready' ? current.sttPath : findStored(current, 'stt'));
    const nextLlmPath = slot === 'llm' ? pickedPath : (current.kind === 'ready' ? current.llmPath : findStored(current, 'llm'));

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
 * When the current status is `needs-setup`, recover any slot that is NOT
 * in `missing` by reading the persisted models.json. (Used during partial
 * pick: STT just succeeded; we need to preserve any previously-set LLM
 * path that's still on disk.)
 */
function findStored(status: ModelStatus, slot: ModelSlot): string | undefined {
  if (status.kind === 'ready') {
    return slot === 'stt' ? status.sttPath : status.llmPath;
  }
  // needs-setup — the slot was missing, so we don't have a path. Returns
  // undefined; saveModelsJson will write '' which loadModelsJson will see
  // as a non-real path on next boot → needs-setup for that slot.
  return undefined;
}
```

- [ ] **Step 3: Run typecheck**

```bash
pnpm typecheck
```
Expected: 0 errors. The `code` annotation in Step 2 is already a plain string-union literal — no conditional-type gymnastics needed.

- [ ] **Step 4: Run all existing tests (model-resolver tests should still pass; ipc.ts is unchanged in behavior)**

```bash
pnpm vitest run
```
Expected: All existing passes; no new test failures.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/main/ipc.ts desktop/src/main/model-resolver.ts
git commit -m "$(cat <<'EOF'
feat(desktop): §5.1 registerModelIpc + CHANNELS extension

- Extend CHANNELS: 'models/status', 'models/pick' (slash convention,
  matches recording/start, session/start, etc.).
- registerModelIpc({ getMainWindow, initialStatus, userDataDir }): two
  ipcMain.handle bindings.
- models/status: synchronous return of cached ModelStatus.
- models/pick: dialog.showOpenDialog with per-slot extension filter →
  validateModelFile → if PASS, AWAIT saveModelsJson (serialized) before
  recomputing status via resolveModels → returns PickResult.status that
  reflects committed disk state (Decision #13).
- Maps validation.reason + dialog.canceled to PickResult.code: PICKER_CANCELLED,
  INVALID_MAGIC_BYTES_STT/LLM, MODEL_READ_FAILED.

No new unit tests in this commit — IPC handlers are exercised via the
integration smoke test in a later task.

Spec: §4.3, §4.4, §5.1 step 6-8, §7 (handler await contract)
EOF
)"
```

---

## Task 6: Preload bridge — `getModelStatus` + `pickModel`

**Spec refs:** §4.5 (preload bridge)

**Files:**
- Modify: `desktop/src/preload/index.ts`

- [ ] **Step 1: Add imports + bridge methods to preload/index.ts**

Update the `import type { ... } from '@shared/ipc-protocol';` line to add `ModelStatus`, `ModelSlot`, `PickResult`, `ModelPickPayload`:

```typescript
import type {
  Capabilities,
  ChunkPayload,
  ChunkResultPayload,
  SessionStartPayload,
  SessionPhasePayload,
  SessionErrorPayload,
  ModelStatus,
  ModelSlot,
  PickResult,
  ModelPickPayload,
} from '@shared/ipc-protocol';
```

In the `contextBridge.exposeInMainWorld('lisna', { ... })` object, add **after** `restartApp:` (line 66):
```typescript
  // --- Step 5 §5.1 — first-run model resolver ---

  getModelStatus: (): Promise<ModelStatus> =>
    ipcRenderer.invoke(CHANNELS.modelStatus),

  pickModel: (slot: ModelSlot): Promise<PickResult> => {
    const payload: ModelPickPayload = { slot };
    return ipcRenderer.invoke(CHANNELS.modelPick, payload);
  },
```

In the `declare global { interface Window { lisna: { ... } } }` block, add inside `lisna: {`:
```typescript
      getModelStatus(): Promise<ModelStatus>;
      pickModel(slot: ModelSlot): Promise<PickResult>;
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm typecheck
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add desktop/src/preload/index.ts
git commit -m "$(cat <<'EOF'
feat(desktop): §5.1 preload bridge — getModelStatus + pickModel

Extend window.lisna via existing contextBridge.exposeInMainWorld pattern.
Two thin invoke wrappers around CHANNELS.modelStatus / CHANNELS.modelPick.

Spec: §4.5
EOF
)"
```

---

## Task 7: Boot wiring — `main/index.ts`

**Spec refs:** §4.2 (boot order — resolveModels → supervisor → registerIpc → registerModelIpc → createWindow)

**Files:**
- Modify: `desktop/src/main/index.ts`

- [ ] **Step 1: Add imports**

Find the existing imports at top of `desktop/src/main/index.ts`. Add:
```typescript
import { resolveModels, registerModelIpc } from './model-resolver';
```

- [ ] **Step 2: Replace the body of `app.whenReady().then(async () => {...})`**

Find the whole block from `app.whenReady().then(async () => {` (line 44) to the matching `});` (line 99).

Replace the body with this new order. **The full new function body:**

```typescript
app.whenReady().then(async () => {
  installSystemAudioHandler();

  // §5.1 — resolve model paths FIRST. Reads <userData>/models.json,
  // existence-checks each path, env-var overrides (LISNA_DEV_STT_MODEL /
  // LISNA_DEV_LLM_MODEL) authoritative when set. Result drives whether
  // renderer mounts Recording (ready) or SetupView (needs-setup).
  const userDataDir = app.getPath('userData');
  const resolveResult = await resolveModels({
    userDataDir,
    envOverride: {
      stt: process.env.LISNA_DEV_STT_MODEL,
      llm: process.env.LISNA_DEV_LLM_MODEL,
    },
  });
  log.info(`[boot] models: ${resolveResult.kind}` +
    (resolveResult.kind === 'ready'
      ? ` STT=${redactPath(resolveResult.sttPath)} LLM=${redactPath(resolveResult.llmPath)}`
      : ` missing=${resolveResult.missing.join(',')}`));

  supervisor = new SidecarSupervisor({
    onCrash: (msg) => {
      log.error('[sidecar give-up]', msg);
      handleSidecarGiveUp();
    },
    onExit: handleSidecarExit,
  });
  const client = supervisor.start();
  client.onEvent((e) => log.info('[sidecar event]', e.type));

  try {
    const ready = await client.waitForReady(5000);
    log.info('[sidecar] ready', ready);
  } catch (err) {
    log.error('[sidecar] failed to reach ready state — recording will fail until restart:', err);
  }

  // §5.1 — register IPC handlers BEFORE createWindow so the renderer's
  // first useEffect (getModelStatus on mount) does not race against
  // handler registration.
  registerIpc({
    getMainWindow: () => mainWindow,
    supervisor,
    sttModelPath: resolveResult.kind === 'ready' ? resolveResult.sttPath : undefined,
    llmModelPath: resolveResult.kind === 'ready' ? resolveResult.llmPath : undefined,
  });
  registerModelIpc({
    getMainWindow: () => mainWindow,
    initialStatus: resolveResult,
    userDataDir,
  });

  createWindow();
});
```

(Changes from existing: removed the env-var-only lines 84-85; replaced with `resolveResult` early; moved `registerIpc` before `createWindow`; added `registerModelIpc`; logged `[boot] models: <kind>` instead of separate STT/LLM lines.)

- [ ] **Step 3: Run typecheck**

```bash
pnpm typecheck
```
Expected: 0 errors.

- [ ] **Step 4: Run all tests**

```bash
pnpm vitest run
```
Expected: All passing. Existing main/__tests__ may need to mock `resolveModels` or `registerModelIpc` if they import `main/index.ts` indirectly — most likely they don't.

- [ ] **Step 5: Dev smoke (manual, brief)**

```bash
pnpm dev
```
Expected: Window opens. In the terminal you should see:
- `[boot] models: needs-setup missing=stt,llm` (if no models.json exists yet)
- OR `[boot] models: ready STT=... LLM=...` (if `LISNA_DEV_STT_MODEL` + `LISNA_DEV_LLM_MODEL` env vars are set in shell)

Renderer will show "Lisna v2 — on-device" header but the Recording route will still render until Task 10 wires `getModelStatus`. That's expected — boot order is plumbed but UI not yet routed. Quit dev (Cmd+Q).

- [ ] **Step 6: Commit**

```bash
git add desktop/src/main/index.ts
git commit -m "$(cat <<'EOF'
feat(desktop): §5.1 boot wiring — resolveModels then register-before-createWindow

Reorder app.whenReady():
  1. resolveModels (NEW — reads userData/models.json + env-var overrides)
  2. supervisor.start() + waitForReady (UNCHANGED placement — handlers
     don't depend on sidecar; sidecar handshake stays where it is)
  3. registerIpc({ sttModelPath, llmModelPath threaded from resolveResult })
  4. registerModelIpc (NEW — exposes models/status, models/pick)
  5. createWindow

Register-before-createWindow closes the latent renderer-mount race on
both capabilities (existing) and models/status (new). Sidecar boot keeps
its original position — do NOT re-order waitForReady after createWindow
for first-paint optimization (reintroduces SIDECAR_DOWN flake).

[boot] log line consolidated: `[boot] models: <kind>` ± details.

Spec: §4.2
EOF
)"
```

---

## Task 8: ModelPickerStep + openExternal bridge

**Spec refs:** §6.1 (state machine), §6.2 (strings), §6.3 (visual sketch); plan-reviewer M2 (bridge defined BEFORE component to keep every intermediate state compiling)

**Files:**
- Modify: `desktop/src/main/ipc.ts` (CHANNELS.shellOpenExternal + handler + `shell` import)
- Modify: `desktop/src/preload/index.ts` (openExternal method + declare global)
- Create: `desktop/src/renderer/components/ModelPickerStep.tsx`

**Why bridge-before-component:** `shell.openExternal` is Electron-main API. In a renderer with `contextIsolation: true` + `sandbox: false` (see `main/index.ts:30`), the renderer cannot `import { shell } from 'electron'` directly — it throws at runtime. So we add the safe bridge through preload first, then have the component call `window.lisna.openExternal`. Each step ends with a compilable workspace.

- [ ] **Step 1: Extend `ipc.ts` — `shell` import + CHANNELS.shellOpenExternal + handler**

Update the `import` at top of `desktop/src/main/ipc.ts`:
```typescript
import { app, ipcMain, shell, type BrowserWindow } from 'electron';
```

Inside the existing `CHANNELS` object, add:
```typescript
  /** renderer → main: launch external URL via shell.openExternal.
   *  Guarded https:// allow-list; rejects all other schemes. */
  shellOpenExternal: 'shell/open-external',
```

Inside `registerIpc(deps)`, after the existing `ipcMain.handle(CHANNELS.lifecycleRestart, ...)` block, add:
```typescript
  ipcMain.handle(CHANNELS.shellOpenExternal, async (_e, payload: { url: string }) => {
    // Defense-in-depth: caller already gates Discord URL via
    // isDiscordUrlConfigured(), but the bridge is a public surface — only
    // https:// links are honored. Anything else is logged and dropped.
    if (!/^https:\/\//.test(payload.url)) {
      log.warn('[shell] rejected non-https openExternal', payload.url);
      return;
    }
    await shell.openExternal(payload.url);
  });
```

- [ ] **Step 2: Extend preload bridge — `openExternal` method**

In `desktop/src/preload/index.ts`, inside `contextBridge.exposeInMainWorld('lisna', { ... })`, add:
```typescript
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke(CHANNELS.shellOpenExternal, { url }),
```

Inside the `declare global { interface Window { lisna: { ... } } }` block, add:
```typescript
      openExternal(url: string): Promise<void>;
```

- [ ] **Step 3: Run typecheck — bridge in place, component not yet created**

```bash
pnpm typecheck
```
Expected: 0 errors. The bridge changes are self-contained and compile independently.

- [ ] **Step 4: Create `desktop/src/renderer/components/ModelPickerStep.tsx`**

(Note: no `import { shell } from 'electron'` — uses `window.lisna.openExternal`. No `: JSX.Element` return annotation — matches existing `Recording.tsx` / `ErrorView.tsx` style.)

```typescript
import { useState } from 'react';
import type { ModelSlot, ModelStatus } from '@shared/ipc-protocol';
import { toFriendlyJa } from '../i18n/error-message-map';
import {
  SETUP_STRINGS_JA,
  DISCORD_CHANNEL_URL,
  isDiscordUrlConfigured,
} from '../i18n/setup-strings';

interface Props {
  slot: ModelSlot;
  stepIndicator: { current: 1 | 2; total: 2 };
  /** Re-launch case: preset error code for the missing slot. */
  initialError?: string;
  /** Called after a PASS — status is the authoritative ModelStatus returned
   *  by the main process (spec Decision #13). */
  onSuccess: (status: ModelStatus) => void;
}

/**
 * Single-slot picker step. Reused for STT (Step 1) and LLM (Step 2). Renders:
 *   - step indicator "ステップ N / 2"
 *   - slot-specific title (.bin / .gguf)
 *   - Discord channel hint body
 *   - ファイルを選択 button (triggers window.lisna.pickModel)
 *   - Discord を開く button (only when isDiscordUrlConfigured())
 *   - red inline error strip when error state set
 *
 * On pick FAIL, stores the error code locally and renders the JA copy via
 * toFriendlyJa (re-uses the same i18n map as ErrorView).
 */
export function ModelPickerStep({ slot, stepIndicator, initialError, onSuccess }: Props) {
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [busy, setBusy] = useState(false);

  const title = slot === 'stt' ? SETUP_STRINGS_JA.sttTitle : SETUP_STRINGS_JA.llmTitle;

  async function handlePick(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await window.lisna.pickModel(slot);
      if (result.ok) {
        onSuccess(result.status);
      } else {
        setError(result.code);
      }
    } finally {
      setBusy(false);
    }
  }

  function handleDiscord(): void {
    void window.lisna.openExternal(DISCORD_CHANNEL_URL);
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: 24, fontFamily: 'system-ui' }}>
      <p style={{ color: '#888', fontSize: 14 }}>
        {SETUP_STRINGS_JA.stepIndicator(stepIndicator.current, stepIndicator.total)}
      </p>
      <h2 style={{ marginTop: 8 }}>{title}</h2>
      <p>{SETUP_STRINGS_JA.body}</p>
      <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
        <button
          onClick={handlePick}
          disabled={busy}
          data-testid={`pick-${slot}`}
          style={{ padding: '8px 16px', fontSize: 14 }}
        >
          {SETUP_STRINGS_JA.pickButton}
        </button>
        {isDiscordUrlConfigured() && (
          <button
            onClick={handleDiscord}
            data-testid="discord-open"
            style={{ padding: '8px 16px', fontSize: 14 }}
          >
            {SETUP_STRINGS_JA.discordButton}
          </button>
        )}
      </div>
      {error && (
        <div
          data-testid="picker-error"
          style={{
            marginTop: 16,
            padding: 12,
            border: '1px solid #c33',
            borderRadius: 4,
            color: '#c33',
            background: '#fff5f5',
            fontSize: 14,
          }}
        >
          {toFriendlyJa(error)}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run typecheck**

```bash
pnpm typecheck
```
Expected: 0 errors.

- [ ] **Step 6: Commit (all 3 files together — bridge + component land as one logical unit)**

```bash
git add desktop/src/main/ipc.ts \
        desktop/src/preload/index.ts \
        desktop/src/renderer/components/ModelPickerStep.tsx
git commit -m "$(cat <<'EOF'
feat(desktop): §5.1 ModelPickerStep + shell/open-external bridge

- ipc.ts: CHANNELS.shellOpenExternal + handler with https:// allow-list
  (defense-in-depth against future bad caller URLs).
- preload/index.ts: window.lisna.openExternal renderer-safe wrapper.
- ModelPickerStep: single-slot picker (reused for STT and LLM). Renders
  step indicator, title, Discord hint body, ファイルを選択 + Discord buttons,
  inline JA error strip via toFriendlyJa.
- Discord button hidden by isDiscordUrlConfigured() runtime guard so a
  placeholder URL never reaches shell.openExternal.

No new tests in this commit — covered by SetupView component test +
integration smoke in later tasks.

Spec: §6.1, §6.2, §6.3; plan-reviewer M2 (bridge-before-component ordering)
EOF
)"
```

---

## Task 9: `SetupView` route

**Spec refs:** §6.1 (full state machine: STT → LLM → done → onReady)

**Files:**
- Create: `desktop/src/renderer/routes/SetupView.tsx`

- [ ] **Step 1: Create SetupView**

```typescript
import { useEffect, useState } from 'react';
import type { ModelSlot } from '@shared/ipc-protocol';
import { ModelPickerStep } from '../components/ModelPickerStep';
import { SETUP_STRINGS_JA } from '../i18n/setup-strings';

interface Props {
  /** Slot the user should pick FIRST. On first-run = 'stt'. On re-launch
   *  after a file was deleted = the missing slot (may be 'stt' OR 'llm'). */
  initialStep: ModelSlot;
  /** Error code preset for the initial step (re-launch case). */
  initialError?: string;
  /** Fired once both slots are resolved (status.kind === 'ready'). */
  onReady: () => void;
}

type SetupState =
  | { kind: 'picker'; step: ModelSlot; error?: string }
  | { kind: 'done' };

export function SetupView({ initialStep, initialError, onReady }: Props) {
  const [state, setState] = useState<SetupState>({
    kind: 'picker',
    step: initialStep,
    error: initialError,
  });

  // §6.1: 'done' state auto-redirects to Recording after 300ms fade.
  useEffect(() => {
    if (state.kind !== 'done') return;
    const t = setTimeout(onReady, 300);
    return () => clearTimeout(t);
  }, [state.kind, onReady]);

  if (state.kind === 'done') {
    return (
      <div
        data-testid="setup-done"
        style={{
          maxWidth: 560,
          margin: '0 auto',
          padding: 24,
          fontFamily: 'system-ui',
          textAlign: 'center',
          transition: 'opacity 300ms',
        }}
      >
        <h2>{SETUP_STRINGS_JA.ready}</h2>
      </div>
    );
  }

  // §6.1: step indicator depends on which slot is currently being picked.
  // We always show 2 total. The "current" displayed number is 1 for STT,
  // 2 for LLM — regardless of whether the user landed here on first-run
  // or on re-launch missing the LLM only (in which case Step 1 is skipped
  // visually but still "Step 2" in the indicator — keeps the UI consistent
  // with the total). NOTE: on re-launch missing STT only, "Step 1 / 2"
  // makes sense because LLM is already validated.
  const indicator: { current: 1 | 2; total: 2 } =
    state.step === 'stt' ? { current: 1, total: 2 } : { current: 2, total: 2 };

  return (
    <ModelPickerStep
      slot={state.step}
      stepIndicator={indicator}
      initialError={state.error}
      onSuccess={(status) => {
        if (status.kind === 'ready') {
          setState({ kind: 'done' });
          return;
        }
        // needs-setup — pick the next missing slot. Sort guarantees 'stt'
        // comes before 'llm' so [0] is the right pick. The undefined check
        // satisfies noUncheckedIndexedAccess; logically unreachable since
        // needs-setup always has ≥1 missing slot (otherwise it'd be ready).
        const nextSlot = status.missing[0];
        if (!nextSlot) {
          setState({ kind: 'done' });  // defensive fall-through
          return;
        }
        setState({ kind: 'picker', step: nextSlot });
      }}
    />
  );
}
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm typecheck
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add desktop/src/renderer/routes/SetupView.tsx
git commit -m "$(cat <<'EOF'
feat(desktop): §5.1 SetupView route — full-screen picker state machine

- 'picker' state: renders ModelPickerStep for current slot. On PickResult
  PASS, advances based on returned status (needs-setup → next missing
  slot; ready → 'done').
- 'done' state: 300ms timeout then onReady() — auto-redirect, no manual
  "始める" button (per founder "최대한 자동" decision).
- initialStep + initialError props: re-launch case where one slot is
  already-validated and the missing slot's error is pre-rendered.

Spec: §6.1
EOF
)"
```

---

## Task 10: `App.tsx` — `'booting'` + `'setup'` view kinds

**Spec refs:** §6.1 (App.tsx initial state + transitions), Decision #16 (booting prevents Recording flash)

**Files:**
- Modify: `desktop/src/renderer/App.tsx`

- [ ] **Step 1: Extend the `View` discriminated union**

Find the `type View = ...` block (lines 11-15). Replace with:

```typescript
type View =
  | { kind: 'booting' }
  | { kind: 'setup'; initialStep: 'stt' | 'llm'; initialError?: string }
  | { kind: 'recording'; segments: TranscriptSegment[] }
  | { kind: 'finalizing'; phase: FinalizingPhase; segments: TranscriptSegment[] }
  | { kind: 'note'; note: Note }
  | { kind: 'error'; message: string; segments: TranscriptSegment[]; permanent?: boolean };
```

- [ ] **Step 2: Change initial state from `'recording'` to `'booting'`**

Find:
```typescript
const [view, setView] = useState<View>({ kind: 'recording', segments: [] });
```
Replace with:
```typescript
const [view, setView] = useState<View>({ kind: 'booting' });
```

- [ ] **Step 3: Add the initial `getModelStatus` useEffect**

After the existing three `useEffect` hooks (after the `onSessionError` block, around line 71), add:

```typescript
  // §5.1 — on mount, query main for the boot-resolved ModelStatus.
  // While in 'booting', the existing onChunk/onPhase/onSessionError
  // listeners are naturally inert (their prev.kind guards no-op).
  useEffect(() => {
    void window.lisna.getModelStatus().then((status) => {
      if (status.kind === 'ready') {
        setView({ kind: 'recording', segments: [] });
        return;
      }
      // status.missing is sorted: 'stt' before 'llm'. First missing slot
      // is where the picker starts. If we're re-prompting because a
      // previously-set path is now missing, surface that as initialError.
      const initialStep = status.missing[0];
      if (!initialStep) {
        // Unreachable: needs-setup always has ≥1 missing slot. Guard for
        // noUncheckedIndexedAccess strictness; if somehow reached, fall
        // through to Recording (kind === 'ready' would have hit earlier).
        setView({ kind: 'recording', segments: [] });
        return;
      }
      const initialError =
        initialStep === 'stt' ? 'MODEL_FILE_MISSING_STT' : 'MODEL_FILE_MISSING_LLM';
      // First-run case: missing.length === 2; treat as no error (clean state).
      const error = status.missing.length === 2 ? undefined : initialError;
      setView({ kind: 'setup', initialStep, initialError: error });
    });
  }, []);
```

- [ ] **Step 4: Update the import block to include `SetupView`**

Find:
```typescript
import { Recording } from './routes/Recording';
import { NoteView } from './routes/NoteView';
import { ErrorView } from './routes/ErrorView';
import { FinalizingView } from './routes/FinalizingView';
```
Add:
```typescript
import { SetupView } from './routes/SetupView';
```

- [ ] **Step 5: Add `'booting'` and `'setup'` cases to `renderView`**

Find the `switch (view.kind) {` block (line 82). Add **before** the `case 'recording':`:

```typescript
    case 'booting':
      return <div data-testid="booting" />;  // null UI; resolved in ~ms
    case 'setup':
      return (
        <SetupView
          initialStep={view.initialStep}
          initialError={view.initialError}
          onReady={() => setView({ kind: 'recording', segments: [] })}
        />
      );
```

- [ ] **Step 6: Verify existing useEffect listeners are safe in booting/setup**

The existing `onChunk`, `onPhase`, `onSessionError` handlers (lines 26-71) all guard internally on `prev.kind`. Spot-check:
- `onChunk` (line 26-35): only acts on `'recording'` or `'finalizing'` — booting/setup naturally no-op.
- `onPhase` (line 40-48): only acts on `'finalizing'` — booting/setup no-op.
- `onSessionError` (line 59-71): the `if (prev.kind === 'error') ...` branch handles error-state idempotency; otherwise transitions to `'error'`. **POTENTIAL ISSUE**: if sidecar crashes during boot before getModelStatus resolves, App jumps from 'booting' → 'error' (`segments` defaults to `[]` since prev.kind !== recording/finalizing). That's acceptable — error view is the right UI for "sidecar died during boot".

No code change needed. The interop note in spec §6.1 covers this.

- [ ] **Step 7: Run typecheck**

```bash
pnpm typecheck
```
Expected: 0 errors. The switch is exhaustive over 6 view kinds.

- [ ] **Step 8: Dev smoke test (manual)**

Quit Electron if running. Move/rename `~/Library/Application Support/Electron/models.json` if present:
```bash
mv ~/Library/Application\ Support/Electron/models.json ~/Library/Application\ Support/Electron/models.json.bak 2>/dev/null || true
```

Run dev:
```bash
pnpm dev
```

Expected:
- Brief `booting` (data-testid="booting", empty UI) for ~100ms
- Then SetupView appears with "ステップ 1 / 2" + "文字起こしモデル (.bin) の選択"

DO NOT actually pick a file yet (Task 11 covers integration smoke). Quit dev (Cmd+Q).

Restore your models.json if applicable:
```bash
mv ~/Library/Application\ Support/Electron/models.json.bak ~/Library/Application\ Support/Electron/models.json 2>/dev/null || true
```

- [ ] **Step 9: Commit**

```bash
git add desktop/src/renderer/App.tsx
git commit -m "$(cat <<'EOF'
feat(desktop): §5.1 App.tsx — booting + setup view kinds

- View union extended: 'booting' (initial, prevents Recording flash) +
  'setup' (full-screen picker via SetupView route).
- Initial state changes from 'recording' to 'booting'.
- New useEffect queries window.lisna.getModelStatus() on mount:
  * kind === 'ready' → 'recording' (existing path)
  * kind === 'needs-setup' → 'setup' with initialStep = first missing slot
  * On re-launch where exactly one slot is missing, initialError is
    preset to MODEL_FILE_MISSING_{STT,LLM} so SetupView renders the
    red strip immediately.
- renderView gains booting (null UI) + setup (SetupView) cases.

Existing onChunk/onPhase/onSessionError listeners remain mounted but
naturally no-op in booting/setup (prev.kind guards handle it).

Spec: §6.1, Decision #16
EOF
)"
```

---

## Task 11: Integration smoke test

**Spec refs:** §10.3 (boot-time scenarios with mocked fs)

**Files:**
- Create: `desktop/src/__tests__/setup-flow.smoke.test.ts`

- [ ] **Step 1: Create the smoke test**

```typescript
/**
 * Step 5 §5.1 — boot-time scenarios. Tests the resolveModels boot path
 * with real filesystem (tmpdir). Verifies that ModelStatus produced by
 * resolveModels matches what the App.tsx initial useEffect would see
 * via getModelStatus.
 *
 * Renderer-side flow (SetupView state transitions) is out of scope here
 * — that's covered by a component test (future task) or manual smoke
 * (Task 12). This file is the boot-orchestration smoke layer only.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveModels, saveModelsJson } from '../main/model-resolver';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lisna-smoke-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function writeRealModel(name: string, slot: 'stt' | 'llm'): Promise<string> {
  const magic = slot === 'stt' ? [0x6c, 0x6d, 0x67, 0x67] : [0x47, 0x47, 0x55, 0x46];
  const p = path.join(dir, name);
  await fs.writeFile(p, Buffer.from([...magic, 0, 0, 0, 0]));
  return p;
}

describe('setup-flow smoke (boot scenarios)', () => {
  it('1. empty userData → needs-setup with both slots missing', async () => {
    const r = await resolveModels({ userDataDir: dir, envOverride: {} });
    expect(r).toEqual({ kind: 'needs-setup', missing: ['stt', 'llm'] });
  });

  it('2. valid models.json + both files exist → ready', async () => {
    const stt = await writeRealModel('w.bin', 'stt');
    const llm = await writeRealModel('l.gguf', 'llm');
    await saveModelsJson(dir, { version: 1, sttPath: stt, llmPath: llm });
    expect(await resolveModels({ userDataDir: dir, envOverride: {} }))
      .toEqual({ kind: 'ready', sttPath: stt, llmPath: llm });
  });

  it('3. stale models.json (LLM file deleted) → needs-setup [llm]', async () => {
    const stt = await writeRealModel('w.bin', 'stt');
    await saveModelsJson(dir, {
      version: 1,
      sttPath: stt,
      llmPath: path.join(dir, 'deleted.gguf'),
    });
    expect(await resolveModels({ userDataDir: dir, envOverride: {} }))
      .toEqual({ kind: 'needs-setup', missing: ['llm'] });
  });

  it('4. env-var override active → ready (env paths)', async () => {
    const stt = await writeRealModel('env-w.bin', 'stt');
    const llm = await writeRealModel('env-l.gguf', 'llm');
    expect(await resolveModels({
      userDataDir: dir,
      envOverride: { stt, llm },
    })).toEqual({ kind: 'ready', sttPath: stt, llmPath: llm });
  });

  it('5. env-var set BUT env file missing → needs-setup; no fallback to models.json', async () => {
    const realStt = await writeRealModel('real-w.bin', 'stt');
    const realLlm = await writeRealModel('real-l.gguf', 'llm');
    // models.json points to real files
    await saveModelsJson(dir, { version: 1, sttPath: realStt, llmPath: realLlm });
    // But env override points to a non-existent file for STT
    const r = await resolveModels({
      userDataDir: dir,
      envOverride: { stt: path.join(dir, 'nope.bin'), llm: realLlm },
    });
    // Env wins authoritatively; STT missing because env path doesn't exist.
    // Does NOT fall back to models.json's sttPath.
    expect(r).toEqual({ kind: 'needs-setup', missing: ['stt'] });
  });

  it('6. models.json.tmp orphan + valid models.json → tmp deleted on entry, valid result', async () => {
    const stt = await writeRealModel('w.bin', 'stt');
    const llm = await writeRealModel('l.gguf', 'llm');
    await saveModelsJson(dir, { version: 1, sttPath: stt, llmPath: llm });
    // Simulate a crash-leftover .tmp file
    await fs.writeFile(path.join(dir, 'models.json.tmp'), 'orphan');
    const r = await resolveModels({ userDataDir: dir, envOverride: {} });
    expect(r).toEqual({ kind: 'ready', sttPath: stt, llmPath: llm });
    // And the orphan is gone
    await expect(fs.stat(path.join(dir, 'models.json.tmp'))).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the smoke**

```bash
pnpm vitest run src/__tests__/setup-flow.smoke.test.ts
```
Expected: 6 tests pass.

- [ ] **Step 3: Run the entire test suite**

```bash
pnpm vitest run
```
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add desktop/src/__tests__/setup-flow.smoke.test.ts
git commit -m "$(cat <<'EOF'
test(desktop): §5.1 setup-flow boot scenarios smoke

6 scenarios via resolveModels + real tmpdir:
  1. empty userData → both missing
  2. valid models.json → ready
  3. stale models.json (one file deleted) → that slot missing
  4. env-var override → env paths win
  5. env-var set but env file missing → authoritative-no-fallback
  6. models.json.tmp orphan → deleted on entry; valid path still returned

Renderer-side state transitions (SetupView) out of this file; covered by
manual smoke in Task 12.

Spec: §10.3
EOF
)"
```

---

## Task 12: Manual verification doc + final manual smoke

**Spec refs:** §10.4 (manual smoke steps)

**Files:**
- Modify: `desktop/docs/manual-verification.md` (append §5.1 section)

- [ ] **Step 1: Read current `manual-verification.md` to find an anchor**

```bash
tail -5 desktop/docs/manual-verification.md
```
Use the output to find the end of the file or the last section marker.

- [ ] **Step 2: Append §5.1 manual flow**

Append to end of `desktop/docs/manual-verification.md`:

```markdown

---

## §5.1 — First-run model resolver (Step 5 Task 1)

**Prereqs:** Two real model files at `~/.lisna-test-models/`:
- `ggml-kotoba-whisper-v2.0-q5_0.bin` (Whisper STT)
- `Llama-3.2-3B-Instruct-Q4_K_M.gguf` (Llama LLM)

If either is missing, see the Discord channel for the alpha distribution links.

### Happy path (first-run)

1. Quit Electron if running. Remove any prior models.json:
   ```bash
   rm -f ~/Library/Application\ Support/Electron/models.json
   ```
2. `pnpm dev` — expect brief "booting" (empty UI), then SetupView Step 1 visible.
3. Click "ファイルを選択" → pick `~/.lisna-test-models/ggml-kotoba-whisper-v2.0-q5_0.bin`.
   Expect transition to Step 2 (no inline error).
4. Click "ファイルを選択" → pick `~/.lisna-test-models/Llama-3.2-3B-Instruct-Q4_K_M.gguf`.
   Expect "準備が完了しました" for 300ms, then Recording view (header "Lisna v2 — on-device").
5. Quit Electron (Cmd+Q). Restart. Expect Recording view directly — no SetupView flash.

### Re-launch with missing file

6. Quit Electron. Move the LLM file aside:
   ```bash
   mv ~/.lisna-test-models/Llama-3.2-3B-Instruct-Q4_K_M.gguf{,.bak}
   ```
7. `pnpm dev` — expect SetupView pre-skipped to Step 2 with red inline strip
   "ノート生成モデルのファイルが見つかりません。もう一度選択してください。"
8. Click "ファイルを選択", dismiss the native dialog. Expect strip changes to
   "選択がキャンセルされました。続行するにはファイルを選択してください。"
9. Restore the LLM file:
   ```bash
   mv ~/.lisna-test-models/Llama-3.2-3B-Instruct-Q4_K_M.gguf{.bak,}
   ```
10. Click "ファイルを選択", pick it. Expect ready → Recording view.

### Wrong format

11. Quit Electron. Remove models.json again. `pnpm dev`. On Step 1, click
    "ファイルを選択" and pick the **LLM** `.gguf` file (not `.bin`). Expect
    red strip "このファイルは文字起こしモデルとして読み込めませんでした。Discord で
    配布されたファイルを再度選択してください。"
12. Click "ファイルを選択" again, pick the real `.bin`. Expect Step 2.

### Discord URL placeholder guard

13. Edit `desktop/src/renderer/i18n/setup-strings.ts`. Set:
    ```typescript
    export const DISCORD_CHANNEL_URL = 'https://discord.com/channels/<server>/<channel>';
    ```
14. Rebuild + dev. Verify Step 1 renders WITHOUT the "Discord で受け取る" button.
15. Restore the real URL.

### Env-var dev override

16. Quit. Set in shell:
    ```bash
    export LISNA_DEV_STT_MODEL=/tmp/does-not-exist.bin
    export LISNA_DEV_LLM_MODEL=~/.lisna-test-models/Llama-3.2-3B-Instruct-Q4_K_M.gguf
    ```
17. `pnpm dev` — expect SetupView Step 1 with `MODEL_FILE_MISSING_STT` strip
    (env-var authoritative; no fallback to models.json).
18. Unset env vars, restart. Expect resolution via models.json (should be ready from earlier).
```

- [ ] **Step 3: Run the manual smoke**

Execute steps 1-12 above. Note any deviations from expected behavior. If any step fails:
- Capture the actual UI state + main process log (`~/Library/Logs/Lisna/main.log`)
- File as an issue in the spec's §13 open questions or as a follow-up commit

- [ ] **Step 4: Final test suite run**

```bash
cd desktop && pnpm typecheck && pnpm test
```
Expected: 0 type errors, all tests pass.

- [ ] **Step 5: Commit doc**

```bash
git add desktop/docs/manual-verification.md
git commit -m "$(cat <<'EOF'
docs(desktop): §5.1 manual verification flow

Append happy path (first-run), re-launch with missing file, wrong format,
Discord placeholder guard, and env-var override scenarios.

Spec: §10.4
EOF
)"
```

---

## Optional Polish (defer if pressed for time)

### Task 13 (optional): 300ms fade animation on `'done'` screen

**Files:** `desktop/src/renderer/routes/SetupView.tsx`

- [ ] Add CSS-only opacity transition on the `'done'` div (already has `transition: 'opacity 300ms'` in Task 9 step 1; add `opacity: 0` initial via a fade-in effect if desired).
- [ ] Commit if implemented:
  ```bash
  git commit -m "polish(desktop): §5.1 SetupView done fade animation"
  ```

---

## Plan completion checklist

After all tasks 1-12 complete:

- [ ] `git log --oneline main..HEAD` shows ~12 commits with `feat(desktop): §5.1 ...` or `test(desktop): §5.1 ...` or `docs(desktop): §5.1 ...` prefixes
- [ ] `pnpm typecheck` from `desktop/`: 0 errors
- [ ] `pnpm test` from `desktop/`: all pass (including the new 26+ tests in model-resolver.test.ts and 6 in setup-flow.smoke.test.ts)
- [ ] Manual flow steps 1-12 from `desktop/docs/manual-verification.md` all complete successfully
- [ ] Discord URL still placeholder (founder will fill before alpha merge — not blocking implementation completion)

If any item fails, do NOT mark the task complete in the source TodoWrite — return to the failing step.

---

## Self-review (writer's spot-check)

After writing this plan I verified:

**Spec coverage:** Every section of the spec maps to a task:
- §4.1 file layout → Task 1 (types, i18n), 2-4 (model-resolver), 5 (ipc.ts), 6 (preload), 7 (main/index), 8-9 (UI), 10 (App.tsx), 11 (smoke), 12 (manual doc) ✓
- §4.2 boot order → Task 7 ✓
- §4.3 CHANNELS → Task 5 ✓
- §4.4 types → Task 1 ✓
- §4.5 preload → Task 6 ✓
- §5 data flow → Task 5 (IPC handler), Task 10 (App initial fetch) ✓
- §6 UX state machine + strings → Tasks 8-9, Task 1 (strings file) ✓
- §7 validation + serializeWrite → Task 2 ✓
- §8 persistence (load/save + .tmp recovery) → Task 3 ✓
- §9 error codes → Task 1 ✓
- §10.1-10.4 tests → Tasks 2-4 (unit, model-resolver.test.ts), Task 11 (smoke), Task 12 (manual) ✓
- §13 open items → handled (Discord URL guard implemented in Task 1; mid-session delete confirmed out-of-scope and not in plan) ✓
- §14 reviewer checklist → each item maps to a task implementation step ✓

**Placeholder scan:** No "TBD", "implement later", "similar to Task N", or partial code. All steps include the exact code or commands.

**Type consistency:** `ModelSlot`, `ModelStatus`, `PickResult`, `ResolveResult`, `ModelPickPayload` consistently named across Task 1 (types), Task 2-4 (model-resolver internals), Task 5 (IPC handler), Task 6 (preload), Task 8 (component props), Task 10 (App.tsx). `validateModelFile`, `serializeWrite`, `loadModelsJson`, `saveModelsJson`, `resolveModels`, `registerModelIpc` consistently named across model-resolver.ts and its callers. `SETUP_STRINGS_JA`, `DISCORD_CHANNEL_URL`, `isDiscordUrlConfigured` consistent in setup-strings.ts and ModelPickerStep.tsx.

No gaps identified.
