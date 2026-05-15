# Step 5 Task 1 — First-Run Model Resolver (§5.1 Sub-Spec)

**Status:** Ready for implementation planning
**Parent spec:** [`2026-05-15-step-5-alpha-distribution-gate-design.md`](./2026-05-15-step-5-alpha-distribution-gate-design.md) §5.1
**ADR:** [`2026-05-15-step-5-section-9-decisions.md`](../decisions/2026-05-15-step-5-section-9-decisions.md) — §1 packaging, §3 polite desu/masu register, §4 Discord alpha channel
**Worktree / branch:** `claude/romantic-kepler-c9b85e` (PR #6, main+93)

**Revision history (within this spec write):**
- Draft 1 → integrated TS/Electron + JA copy expert review
- Draft 2 → integrated architecture-reviewer findings (5 must-fix/should-fix items): `PickResult.status` authoritative, `.tmp` orphan recovery, in-module write serialization, handler registration before `createWindow`, App.tsx `'booting'` view kind, Discord URL placeholder runtime guard, env-var fall-through pinned, `ResolveResult` typed explicitly, mid-session delete punted

---

## 1. Goal

First-run users land on a setup view that walks them through picking two model files (Whisper STT + Llama LLM), validates each by magic-byte, persists paths to `<userData>/models.json`, and proceeds to the Recording view. Re-launches existence-check both paths at boot and re-prompt for any missing files.

This unblocks the alpha distribution path defined in Step 5 §1 (file-picker; no DMG bundle, no CDN).

---

## 2. Scope

**In scope**

- Pure resolver module (`model-resolver.ts`) with `validateModelFile()`, `resolveModels()`, `loadModelsJson()`, `saveModelsJson()`, `registerModelIpc()`
- Boot-time integration in `main/index.ts` — `resolveModels()` runs before `registerIpc()`; both IPC handler registrations complete before `createWindow()`
- IPC channels `models/status`, `models/pick`
- Preload bridge: `getModelStatus`, `pickModel` on `window.lisna`
- SetupView route + ModelPickerStep component
- `App.tsx` View union extension (new `'booting'` and `'setup'` kinds)
- 6 new i18n error codes + UI strings file (`setup-strings.ts`)
- In-module write serialization (single Promise chain) for concurrent-pick safety
- `.tmp` orphan recovery on resolver load
- Unit tests + integration smoke + manual verification entries

**Out of scope** (will be done elsewhere)

- Settings/swap UI for changing models post-pick (Phase 6+)
- URL/HTTP model download (Phase 6+)
- DMG packaging — `electron-builder.yml` (Step 5 §5.2, separate task)
- Codesign / notarize (Apple Dev Program — founder gated)
- Re-validating magic bytes on every boot (validated once at pick; existence-only on boot)
- Schema migration `models.json` v1 → v2 (not needed for v2.0)
- Drag-drop alternative to native file picker (defer to founder feedback after alpha)
- Mid-session model file deletion (resolver runs at boot only; in-session disappearance is covered by `ipc.ts:127`'s defensive `MODELS_NOT_CONFIGURED` for `session/start`, otherwise out of v2.0 scope)

---

## 3. Decisions baked in (from brainstorm + 3-stage review)

| # | Decision | Source |
|---|---|---|
| 1 | Picker flow = **Sequential** (STT → LLM, single-slot screen) | Founder, brainstorm Q1 |
| 2 | Validation = **Strict per-slot magic-byte** | Founder, brainstorm Q2 |
| 3 | Picker copy = **+ Discord channel guidance** (no model spec text) | Founder, brainstorm Q3 |
| 4 | Re-launch = **Boot-time existence check** (re-prompt on missing) | Founder, brainstorm Q4 |
| 5 | Step 2 PASS = **300ms fade + auto-redirect** (no "始める" button) | Founder, "최대한 자동" |
| 6 | Module structure = **single `model-resolver.ts`** with pure fns + `registerModelIpc()` (mirror `ipc.ts` pattern) | TS/Electron review |
| 7 | IPC naming = **`models/status` + `models/pick`** (slash, matches existing CHANNELS convention) | TS/Electron review |
| 8 | Renderer state = **preload bridge** (`contextBridge.exposeInMainWorld('lisna', ...)`), no window globals | TS/Electron review |
| 9 | Types in **`desktop/src/shared/ipc-protocol.ts`** (extend, not new file) | TS/Electron review |
| 10 | Model user-facing names = **「文字起こしモデル」 / 「ノート生成モデル」** (founder's own ADR §3.1 names — already in prod for STT_TIMEOUT / LLM_LOAD_TIMEOUT) | JA copy review |
| 11 | Error strings = **diagnosis + recovery clause** (matches 9/13 existing pattern) | JA copy review |
| 12 | `.bin` / `.gguf` extensions = **picker titles only**, NOT in error copy (tech-leak) | JA copy review |
| 13 | `PickResult.ok=true.status` = **authoritative** — renderer never re-fetches `getModelStatus()` after `pickModel` returns. Initial mount is the only `getModelStatus` caller | Arch review MUST-1 |
| 14 | Concurrent picks = **in-module Promise serialization** in resolver (no `PICKER_BUSY` code) | Arch review MUST-3 |
| 15 | IPC handlers register **before `createWindow`** to eliminate mount race | Arch review SHOULD-4 |
| 16 | App.tsx initial = `'booting'` view kind; transitions to `'setup'` or `'recording'` on first `getModelStatus()` resolve. Prevents Recording flash | Arch review SHOULD-5 |
| 17 | Discord button hidden at runtime if `DISCORD_CHANNEL_URL.includes('<')` (placeholder marker) | Arch review SHOULD-6 |
| 18 | Env-var override is **authoritative when set** — does NOT fall through to `models.json` if env-var file is missing. Returns `needs-setup` for the missing slot | Arch review SHOULD-7 |

---

## 4. Architecture

### 4.1 File layout

```
desktop/src/main/
  model-resolver.ts                       # NEW — pure fns + registerModelIpc()
  __tests__/model-resolver.test.ts        # NEW
  index.ts                                # CHANGED — resolveModels then register-both-before-createWindow
  ipc.ts                                  # MINOR — extend CHANNELS const

desktop/src/preload/
  index.ts                                # CHANGED — add getModelStatus / pickModel

desktop/src/shared/
  ipc-protocol.ts                         # CHANGED — add ModelSlot, ModelStatus, PickResult, ResolveResult

desktop/src/renderer/
  App.tsx                                 # CHANGED — extend View union with 'booting' + 'setup' kinds; first useEffect calls getModelStatus
  i18n/error-message-map.ts               # CHANGED — append 6 codes + JA strings
  i18n/setup-strings.ts                   # NEW — picker UI strings (titles, body, buttons, success)
  i18n/__tests__/error-message-map.test.ts # PASSES on new strings (existing invariants)
  routes/SetupView.tsx                    # NEW — full-screen view, STT→LLM state machine
  components/ModelPickerStep.tsx          # NEW — single-slot step (reused for both)

desktop/src/__tests__/
  setup-flow.smoke.test.ts                # NEW — boot-time scenarios, mocked fs

desktop/docs/manual-verification.md       # APPEND — §5.1 manual flow
```

### 4.2 Boot order (`main/index.ts`)

```
app.whenReady()
  → const resolveResult = await resolveModels({
      userDataDir: app.getPath('userData'),
      envOverride: {
        stt: process.env.LISNA_DEV_STT_MODEL,
        llm: process.env.LISNA_DEV_LLM_MODEL,
      },
    })
  → supervisor.start()
  → registerIpc({                           // BEFORE createWindow (closes existing capabilities race too)
      getMainWindow, supervisor,
      sttModelPath: resolveResult.kind === 'ready' ? resolveResult.sttPath : undefined,
      llmModelPath: resolveResult.kind === 'ready' ? resolveResult.llmPath : undefined,
    })
  → registerModelIpc({                      // BEFORE createWindow
      getMainWindow,
      initialStatus: resolveResult,
    })
  → createWindow → mainWindow.loadURL(...)  // renderer's first useEffect can now safely invoke models/status
```

**Why this order**
- `MODELS_NOT_CONFIGURED` (currently `ipc.ts:127`) becomes defensive-only — under v2.0 the renderer will never reach `session/start` without a `ready` status because SetupView gates the transition.
- Env-var dev overrides (`LISNA_DEV_STT_MODEL` / `LISNA_DEV_LLM_MODEL`) keep working: env var supplies the path, resolveModels existence-checks the file, `ModelStatus` reports `ready` (or `needs-setup` for the missing slot — env-var override does NOT fall through to `models.json`).
- Single source of truth: resolver writes → registerIpc reads → no split between env-var and persisted state.
- **Mount race fix**: both `registerIpc` and `registerModelIpc` complete before `createWindow()`. The renderer's first `useEffect` will not see "No handler registered for 'models/status'". The same fix retroactively closes a latent race on the existing `capabilities` channel, which was only masked by renderer-side mount delay.

### 4.3 IPC channels (extend `CHANNELS` in `ipc.ts`)

```typescript
modelStatus: 'models/status',  // renderer → main (invoke): query ModelStatus
modelPick:   'models/pick',    // renderer → main (invoke): native dialog + validate + save for one slot
```

Naming follows existing `recording/start`, `session/start`, `platform/capabilities`, `lifecycle/restart` convention.

### 4.4 Types (`shared/ipc-protocol.ts`)

```typescript
export type ModelSlot = 'stt' | 'llm';

export type ModelStatus =
  | { kind: 'ready'; sttPath: string; llmPath: string }
  | { kind: 'needs-setup'; missing: ModelSlot[] };  // sorted: 'stt' before 'llm'

/** Internal alias used by main/model-resolver.ts. Same shape as ModelStatus — separately
 *  named so test types and resolver types can diverge later without a renderer break. */
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
```

**Authoritative-status rule (MUST-1):** When `pickModel(slot)` resolves with `{ ok: true, status }`, that `status` is the authoritative current state. The renderer does NOT re-fetch via `getModelStatus()` after a successful pick — `status` already reflects the persisted state after the in-module write completed. `getModelStatus()` is called exactly once: on initial App mount. This eliminates a race where `pickModel` and a concurrent `getModelStatus` could return inconsistent views.

### 4.5 Preload bridge (`preload/index.ts`)

```typescript
contextBridge.exposeInMainWorld('lisna', {
  // ... existing
  getModelStatus: (): Promise<ModelStatus> => ipcRenderer.invoke(CHANNELS.modelStatus),
  pickModel: (slot: ModelSlot): Promise<PickResult> => ipcRenderer.invoke(CHANNELS.modelPick, { slot }),
});
```

`declare global { interface Window { lisna: { ... } } }` block extended accordingly.

---

## 5. Data flow

### 5.1 First-run (no `models.json`)

1. `app.whenReady()` → `resolveModels()` → file missing → returns `{ kind: 'needs-setup', missing: ['stt', 'llm'] }`
2. `registerIpc({ sttModelPath: undefined, llmModelPath: undefined, ... })` + `registerModelIpc({...})` — both complete BEFORE `createWindow`
3. `createWindow()` → renderer loads → App.tsx initial state = `{ kind: 'booting' }` (renders splash or `null`)
4. First `useEffect` calls `window.lisna.getModelStatus()` → receives `needs-setup` → setView `{ kind: 'setup', step: 'stt', error: null }`
5. SetupView renders Step 1 (STT picker) with `SETUP_STRINGS_JA.sttTitle` + body + buttons
6. User clicks 「ファイルを選択」 → `await window.lisna.pickModel('stt')` → main shows native dialog (filter `*.bin`)
7. User picks file → `validateModelFile(path, 'stt')`
   - PASS: queue persist `{ version: 1, sttPath: <picked>, llmPath: '' }` via atomic write (serialized in-module) → return `{ ok: true, status: { kind: 'needs-setup', missing: ['llm'] } }`
   - FAIL `wrong-format`: return `{ ok: false, code: 'INVALID_MAGIC_BYTES_STT' }` (no write)
   - FAIL `unreadable`: return `{ ok: false, code: 'MODEL_READ_FAILED' }` (no write)
8. Renderer:
   - PASS: `setView({ kind: 'setup', step: 'llm', error: null })` — reads `status` directly from `PickResult`, never re-invokes `getModelStatus`
   - FAIL: `setView({ ...prev, error: <code> })` → ModelPickerStep renders red inline strip via `toFriendlyJa(code)`
9. Repeat steps 6-8 for LLM (Step 2)
10. LLM PASS: `models.json` now has both paths → return `{ ok: true, status: { kind: 'ready', sttPath, llmPath } }`
11. Renderer sets `view = { kind: 'setup', step: 'done' }`, renders 「準備が完了しました」 for 300ms with opacity fade, then calls `onReady()` → `App.tsx` transitions to `{ kind: 'recording', segments: [] }`

### 5.2 Re-launch (paths persisted, one file moved)

1. `resolveModels()` reads `models.json` v1 → both paths present
2. For each path: `fs.access(path)` — STT exists, LLM missing
3. Return `{ kind: 'needs-setup', missing: ['llm'] }`. Resolver retains the still-valid STT path internally for the eventual rewrite.
4. `registerIpc({ sttModelPath: <valid>, llmModelPath: undefined })`
5. Renderer mounts → `App.tsx` initial = `booting` → `getModelStatus()` returns `needs-setup` with `missing: ['llm']` → transitions to `{ kind: 'setup', step: 'llm', error: 'MODEL_FILE_MISSING_LLM' }`
6. SetupView mounts pre-skipped to Step 2 with red inline notice via `toFriendlyJa('MODEL_FILE_MISSING_LLM')`
7. User completes Step 2 → `models.json` updated → ready

### 5.3 Picker cancelled mid-flow

User dismisses native dialog → main returns `{ ok: false, code: 'PICKER_CANCELLED' }` → SetupView stays on current step + renders inline 「選択がキャンセルされました。続行するにはファイルを選択してください。」

### 5.4 Env-var override (dev only)

`LISNA_DEV_STT_MODEL=/path/to/whisper.bin pnpm dev` — `resolveModels()` checks env vars first. If BOTH env vars are set:
- **Both files exist** → `{ kind: 'ready', sttPath: env.STT, llmPath: env.LLM }`. `models.json` is not consulted.
- **One file missing** → `{ kind: 'needs-setup', missing: ['stt'] }` (or `'llm'`). Env-var override is authoritative; it does NOT fall through to `models.json` for the missing slot. Dev intent is honored. Saving a new path via the picker writes to `models.json` as usual; on next dev launch, env-var still wins.

If only one env var is set, the other slot reads from `models.json` as if no override. (Asymmetric override supported.)

### 5.5 Crash-recovery on resolver load (`loadModelsJson`)

On resolver entry: if `<userData>/models.json.tmp` exists (orphan from a crashed write), delete it before reading `models.json`. The atomic-write contract guarantees `models.json` itself is never partial — only the `.tmp` can be left over. Idempotent on repeated boot.

---

## 6. UX flow & copy

### 6.1 App.tsx → SetupView state machine

```
App.tsx initial: { kind: 'booting' }
  └ first useEffect: getModelStatus()
      ├ status.kind = 'ready'         → { kind: 'recording', segments: [] }
      └ status.kind = 'needs-setup'   → { kind: 'setup', step: missing[0], error: <if re-launch missing else null> }

SetupView state machine:
  { step: 'stt', error: null | <code> }
    ├ pickModel('stt') → ok=true     → setStep('llm')   (reads status from PickResult; no getModelStatus)
    ├ pickModel('stt') → ok=false    → setError(code), stay on 'stt'
    └ Discord button click            → shell.openExternal(DISCORD_CHANNEL_URL)

  { step: 'llm', error: null | <code> }
    ├ pickModel('llm') → ok=true     → setStep('done')
    ├ pickModel('llm') → ok=false    → setError(code), stay on 'llm'
    └ Discord button click            → shell.openExternal(DISCORD_CHANNEL_URL)

  { step: 'done' }
    └ effect: 300ms timer            → onReady()        → parent sets view='recording'
```

### 6.2 Strings (`renderer/i18n/setup-strings.ts`)

```typescript
export const SETUP_STRINGS_JA = {
  stepIndicator: (current: 1 | 2, total: 2) => `ステップ ${current} / ${total}`,
  sttTitle: '文字起こしモデル (.bin) の選択',
  llmTitle: 'ノート生成モデル (.gguf) の選択',
  body: 'Discord #lisna-alpha チャンネルから届いたファイルを選択してください。',
  pickButton: 'ファイルを選択',
  discordButton: 'Discord で受け取る',
  ready: '準備が完了しました',
} as const;

// Discord channel URL constant + runtime placeholder guard.
export const DISCORD_CHANNEL_URL = 'https://discord.com/channels/<server>/<channel>';
// Founder fills <server>/<channel> before alpha merge. If still containing '<',
// the Discord button is hidden at runtime (see ModelPickerStep render guard).
export const isDiscordUrlConfigured = () => !DISCORD_CHANNEL_URL.includes('<');
```

`ModelPickerStep.tsx` renders the Discord button only when `isDiscordUrlConfigured()` returns true. If founder ships with placeholder URL, the button is silently absent rather than opening a broken link.

### 6.3 Visual sketch (HTML only for v2.0 alpha; no Figma)

```
+--------------------------------------------------------+
|                                                        |
|   ステップ 1 / 2                                       |
|                                                        |
|   文字起こしモデル (.bin) の選択                       |
|                                                        |
|   Discord #lisna-alpha チャンネルから届いた           |
|   ファイルを選択してください。                         |
|                                                        |
|   [ ファイルを選択 ]   [ Discord で受け取る ]          |
|                                                        |
|   ┌──────────────────────────────────────────┐         |
|   │ このファイルは文字起こしモデルとして     │ (error  |
|   │ 読み込めませんでした。Discord で配布     │  strip, |
|   │ されたファイルを再度選択してください。   │  red)   |
|   └──────────────────────────────────────────┘         |
|                                                        |
+--------------------------------------------------------+
```

No step-transition animation. Only animation = 300ms opacity fade on the `'done'` ready screen before redirect.

---

## 7. Validation + serialization

```typescript
// model-resolver.ts (pure parts shown)
import { promises as fs } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';

const STT_MAGIC_LMGG = Buffer.from([0x6c, 0x6d, 0x67, 0x67]);  // 'lmgg'
const STT_MAGIC_TJGG = Buffer.from([0x74, 0x6a, 0x67, 0x67]);  // 'tjgg' (quantized variant)
const LLM_MAGIC_GGUF = Buffer.from([0x47, 0x47, 0x55, 0x46]);  // 'GGUF'

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: 'wrong-format' | 'unreadable' };

export async function validateModelFile(path: string, slot: ModelSlot): Promise<ValidationResult> {
  let fd: FileHandle | null = null;
  try {
    fd = await fs.open(path, 'r');
    const buf = Buffer.alloc(4);
    const { bytesRead } = await fd.read(buf, 0, 4, 0);
    if (bytesRead < 4) return { ok: false, reason: 'unreadable' };
    if (slot === 'stt') {
      const isGgml = buf.equals(STT_MAGIC_LMGG) || buf.equals(STT_MAGIC_TJGG);
      return isGgml ? { ok: true } : { ok: false, reason: 'wrong-format' };
    }
    return buf.equals(LLM_MAGIC_GGUF) ? { ok: true } : { ok: false, reason: 'wrong-format' };
  } catch (err) {
    log.error('[model-resolver] validation failed', redactPath(path), err);
    return { ok: false, reason: 'unreadable' };
  } finally {
    if (fd) await fd.close().catch(() => {});  // best-effort; no throw-during-throw
  }
}

// --- Concurrent-write serialization (MUST-3) ---
//
// All writes to models.json funnel through a single Promise chain. A second
// pickModel invocation arriving while the first's write is in flight queues
// onto this chain; users see sequential ordering with no PICKER_BUSY rejection.
// Sequential UX (Step 1 → Step 2) makes user-initiated concurrency unlikely,
// but the guard is cheap and prevents data loss on a hypothetical race.
let _writeChain: Promise<void> = Promise.resolve();
function serializeWrite<T>(fn: () => Promise<T>): Promise<T> {
  const next = _writeChain.then(fn, fn);  // run fn whether previous resolved or rejected
  _writeChain = next.then(() => undefined, () => undefined);
  return next;
}
```

IPC handler in `registerModelIpc` maps `ValidationResult` + dialog outcome to `PickResult.code`:
- `{ ok: false, reason: 'wrong-format' }` + `slot==='stt'` → `INVALID_MAGIC_BYTES_STT`
- `{ ok: false, reason: 'wrong-format' }` + `slot==='llm'` → `INVALID_MAGIC_BYTES_LLM`
- `{ ok: false, reason: 'unreadable' }` → `MODEL_READ_FAILED`
- native dialog dismissed (no path returned) → `PICKER_CANCELLED` (no validation called)

---

## 8. Persistence

### 8.1 Schema (`<userData>/models.json`)

```json
{
  "version": 1,
  "sttPath": "/absolute/path/to/whisper.bin",
  "llmPath": "/absolute/path/to/llama.gguf"
}
```

`version: 1` reserved for future schema migration. v2.0 ships v1 only. A file with `version !== 1` is treated as malformed → falls back to `needs-setup`.

### 8.2 Atomic write (macOS APFS-safe)

```typescript
async function saveModelsJson(dir: string, content: ModelsJson): Promise<void> {
  return serializeWrite(async () => {
    const final = path.join(dir, 'models.json');
    const tmp = path.join(dir, 'models.json.tmp');
    const data = Buffer.from(JSON.stringify(content, null, 2));

    // 1. write tmp + fsync file
    const fileFd = await fs.open(tmp, 'w');
    try {
      await fileFd.write(data, 0, data.length, 0);
      await fileFd.sync();
    } finally {
      await fileFd.close();
    }

    // 2. rename (POSIX atomic on same filesystem)
    await fs.rename(tmp, final);

    // 3. fsync the directory entry (APFS reorders metadata otherwise)
    //    Node's fs.promises.open on a directory yields a read-fd whose
    //    FileHandle.sync() invokes fsync(2) on that fd — verified
    //    working on macOS 14 (Darwin 23.x). One test pins this.
    const dirFd = await fs.open(dir, 'r');
    try { await dirFd.sync(); } finally { await dirFd.close(); }
  });
}
```

### 8.3 Crash-recovery on `loadModelsJson` (MUST-2)

```typescript
async function loadModelsJson(dir: string): Promise<ModelsJson | null> {
  const final = path.join(dir, 'models.json');
  const tmp = path.join(dir, 'models.json.tmp');

  // 1. Orphan-tmp recovery: a crashed write may leave .tmp behind. The
  //    rename in saveModelsJson is atomic — models.json itself is never
  //    partial — so the .tmp is discardable.
  await fs.unlink(tmp).catch(() => {});  // ignore ENOENT

  // 2. Read + parse models.json (returns null on missing / malformed)
  try {
    const raw = await fs.readFile(final, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1) return null;
    if (typeof parsed.sttPath !== 'string' || typeof parsed.llmPath !== 'string') return null;
    return parsed as ModelsJson;
  } catch {
    return null;
  }
}
```

### 8.4 Packaged-vs-dev userData (known limitation, documented)

| Build | `app.getPath('userData')` |
|---|---|
| `pnpm dev` (Electron's default Bundle ID) | `~/Library/Application Support/Electron/models.json` |
| Packaged DMG (after `electron-builder.yml`) | `~/Library/Application Support/Lisna/models.json` |

First packaged-build run will not inherit dev `models.json` → SetupView re-runs. Documented behavior — a future Settings UI could offer "import from Electron/" if it becomes a real pain point in alpha feedback.

---

## 9. Error codes (append to `error-message-map.ts`)

### 9.1 `ALL_ERROR_CODES` additions

```typescript
// Step 5 §5.1 — first-run model resolver
'MODEL_FILE_MISSING_STT',
'MODEL_FILE_MISSING_LLM',
'INVALID_MAGIC_BYTES_STT',
'INVALID_MAGIC_BYTES_LLM',
'MODEL_READ_FAILED',
'PICKER_CANCELLED',
```

(No `PICKER_BUSY` code — concurrent picks serialize internally per §7.)

### 9.2 `ERROR_MESSAGE_MAP_JA` additions

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

Tests in `i18n/__tests__/error-message-map.test.ts` pin polite-form + 「。」 terminator + length bounds — they must pass on the new strings before merge.

---

## 10. Testing

### 10.1 Unit — `desktop/src/main/__tests__/model-resolver.test.ts`

| # | Test | Setup | Expect |
|---|---|---|---|
| 1 | validate STT GGML primary | tmp file w/ `lmgg` magic | `{ ok: true }` |
| 2 | validate STT GGML alt | tmp file w/ `tjgg` magic | `{ ok: true }` |
| 3 | validate STT wrong fmt | tmp file w/ `GGUF` magic | `{ ok: false, reason: 'wrong-format' }` |
| 4 | validate STT short file | tmp file < 4 bytes | `{ ok: false, reason: 'unreadable' }` |
| 5 | validate STT missing | non-existent path | `{ ok: false, reason: 'unreadable' }` |
| 6 | validate STT EACCES | tmp file with chmod 000 | `{ ok: false, reason: 'unreadable' }` (catch path) |
| 7 | validate LLM GGUF | tmp file w/ `GGUF` magic | `{ ok: true }` |
| 8 | validate LLM wrong fmt | tmp file w/ `lmgg` magic | `{ ok: false, reason: 'wrong-format' }` |
| 9 | resolveModels — no file | empty userData | `{ kind: 'needs-setup', missing: ['stt', 'llm'] }` |
| 10 | resolveModels — valid | models.json + 2 real files | `{ kind: 'ready', sttPath, llmPath }` |
| 11 | resolveModels — STT deleted | models.json + only LLM | `{ kind: 'needs-setup', missing: ['stt'] }` |
| 12 | resolveModels — corrupt JSON | malformed models.json | `{ kind: 'needs-setup', missing: ['stt', 'llm'] }` |
| 13 | resolveModels — version mismatch | models.json `version: 2` | `{ kind: 'needs-setup', missing: ['stt', 'llm'] }` |
| 14 | resolveModels — env both set, files exist | env vars set, no models.json | `{ kind: 'ready', sttPath, llmPath }` (env wins) |
| 15 | resolveModels — env set but file missing | env vars set, env file absent | `{ kind: 'needs-setup', missing: [<slot>] }` (env authoritative; no fallback to models.json) |
| 16 | atomic write — happy path | tmp dir | tmp gone, final present, content matches |
| 17 | atomic write — dir fsync survives | tmp dir (macOS) | `dirFd.sync()` does not throw |
| 18 | atomic write — fsync throws | mock `fileFd.sync` to reject | tmp persists, no rename, error propagates |
| 19 | loadModelsJson — orphan .tmp present | dir with both models.json + models.json.tmp | tmp deleted on entry, models.json returned |
| 20 | loadModelsJson — only orphan .tmp | dir with only models.json.tmp | tmp deleted, returns null |
| 21 | serializeWrite — concurrent calls | two saveModelsJson invocations launched simultaneously | both complete; final content matches the second (last-writer-wins on the in-module queue) |

### 10.2 i18n — existing test file

`desktop/src/renderer/i18n/__tests__/error-message-map.test.ts` runs on appended codes. Style invariants pinned by the existing tests must pass.

### 10.3 Integration smoke — `desktop/src/__tests__/setup-flow.smoke.test.ts`

Boot-time scenarios using mocked `fs` (no UI):

| # | Scenario | Expected `getModelStatus()` |
|---|---|---|
| 1 | Empty userData | `{ kind: 'needs-setup', missing: ['stt', 'llm'] }` |
| 2 | Valid models.json + both files | `{ kind: 'ready', sttPath, llmPath }` |
| 3 | Stale models.json (LLM file deleted) | `{ kind: 'needs-setup', missing: ['llm'] }` |
| 4 | Env-var override active in dev | `{ kind: 'ready', sttPath, llmPath }` (env paths) |
| 5 | Env-var set BUT env-var file missing | `{ kind: 'needs-setup', missing: [<slot>] }` — env wins authoritatively; no fallback to models.json for that slot |
| 6 | models.json.tmp orphan + valid models.json | `{ kind: 'ready', ... }`; tmp deleted on entry |

Renderer-side flow (SetupView mount + state-machine transitions, App.tsx booting transition) tested via separate component test (`SetupView.test.tsx`, `App.test.tsx`) — out of scope for the integration smoke layer.

### 10.4 Manual smoke — append to `desktop/docs/manual-verification.md`

§5.1 manual flow:
1. Move/delete `~/Library/Application Support/Electron/models.json` if present. Run `pnpm build && pnpm dev` → SetupView Step 1 visible (no Recording flash — booting → setup transition)
2. Click 「ファイルを選択」 → pick `~/.lisna-test-models/ggml-kotoba-whisper-v2.0-q5_0.bin` → Step 2 transition
3. Click 「ファイルを選択」 → pick `~/.lisna-test-models/Llama-3.2-3B-Instruct-Q4_K_M.gguf` → 「準備が完了しました」 → 300ms → Recording view
4. Quit Electron → restart → Recording view directly (no SetupView, no flash)
5. Quit → `rm ~/.lisna-test-models/Llama-3.2-3B-Instruct-Q4_K_M.gguf` → restart → SetupView pre-skipped to Step 2 with red inline `MODEL_FILE_MISSING_LLM` strip
6. (Replace deleted file.) Quit → restart → Open Step 1, click 「ファイルを選択」, dismiss the native dialog → red inline `PICKER_CANCELLED` strip; click again, pick real file → flow proceeds
7. Set `DISCORD_CHANNEL_URL = 'https://discord.com/channels/<server>/<channel>'` placeholder in `setup-strings.ts`, rebuild — confirm Discord button hidden in SetupView. Restore real URL.
8. (Dev-only) Set `LISNA_DEV_STT_MODEL=/nonexistent/path`, restart — SetupView Step 1 with `MODEL_FILE_MISSING_STT` inline; pick a real file. After save, restart without env var — Recording view directly (models.json honored). Restart WITH env var — env wins, returns to setup if env path no longer exists.

---

## 11. Implementation breakdown (rough commit-level)

Estimate **8–10 commits**, bottom-up. Each commit ends with `pnpm typecheck && pnpm test` green.

1. **types + i18n strings** — `ModelSlot`, `ModelStatus`, `PickResult`, `ResolveResult` in `ipc-protocol.ts`; 6 error codes + JA strings; `setup-strings.ts` with `DISCORD_CHANNEL_URL` + `isDiscordUrlConfigured()`
2. **validation** — `validateModelFile()` + `serializeWrite` helper + unit tests 1-8
3. **persistence** — `loadModelsJson()` (with .tmp orphan recovery) + `saveModelsJson()` (atomic write + dir fsync, wrapped in serializeWrite) + unit tests 16-21
4. **resolver** — `resolveModels()` (env-var override + missing detection + JSON sanity + asymmetric override support) + unit tests 9-15
5. **IPC** — `CHANNELS` extension, `registerModelIpc()` with `models/status` + `models/pick` handlers (including native dialog + slot→error-code mapping)
6. **preload** — bridge methods `getModelStatus` / `pickModel`, `declare global` types (split from IPC commit per arch-review nice-to-have)
7. **boot wiring** — `main/index.ts` resolveModels-before-registerIpc, register-before-createWindow, env-var fallback threaded into IpcDeps
8. **SetupView + ModelPickerStep** — components, state machine, inline error rendering, Discord button with placeholder guard
9. **App.tsx view union** — extend with `'booting'` and `'setup'` kinds, initial-mount `getModelStatus()` fetch, transition wiring (no Recording flash)
10. **integration smoke** + manual verification doc updates

Optional polish commit:
- **fade animation** — 300ms opacity transition for `'done'` ready screen (CSS-only)

---

## 12. Out-of-scope confirmation

- `electron-builder.yml`: separate task (Step 5 §5.2). The picker functions correctly in `pnpm dev` regardless of packaging.
- Settings UI for swapping models: Phase 6+
- URL/HTTP model download: Phase 6+
- Schema migration v1→v2: not needed in v2.0; defensive fallback to `needs-setup` covers a hypothetical future-version file
- Magic-byte re-validation on every boot: validated once at pick; existence-only on boot keeps the happy path fast
- Mid-session model file deletion: out of v2.0 scope. The defensive `MODELS_NOT_CONFIGURED` path at `ipc.ts:127` only fires on `session/start`. If a file disappears DURING a session, the sidecar will fail at the next STT/LLM load operation, which is surfaced via the existing session-error path. A proper response (re-prompt mid-session) is Phase 6+.
- Drag-drop file alternative to native picker: collect alpha feedback first, defer.

---

## 13. Open questions / future work

| Item | Disposition |
|---|---|
| Discord channel URL hardcode | Founder fills before alpha merge. Runtime guard (§6.2 `isDiscordUrlConfigured`) hides the button if not configured, preventing broken `shell.openExternal` calls. |
| Drag-drop file alternative to native picker | Defer — collect feedback during alpha first |
| `MODEL_FILE_MOVED` distinct from `MODEL_FILE_MISSING_*` | Unified for v2.0; the SetupView pre-skip provides context. Split in Phase 6 if alpha feedback indicates user confusion |
| "Import models.json from dev location" UX in packaged build | Defer to Phase 6 Settings UI |
| Whisper model name display in picker (e.g., "kotoba-whisper-v2.0-q5_0") | Out — keeps the picker generic and avoids tying copy to a specific upstream model name |
| Mid-session model file deletion handling | Out of §5.1 scope (see §12). Phase 6+ when Settings UI lands and re-prompt mid-session becomes meaningful |
| Last-writer-wins on concurrent picks | Acceptable for v2.0 (sequential UX prevents user-initiated concurrency). If a defect surfaces, add a `PICKER_BUSY` code + queue front-end check |

---

## 14. Reviewer checklist (final, post-review)

- [x] Boot order in §4.2 produces a single source of truth for model paths (env-var → resolver → registerIpc)
- [x] IPC handlers registered BEFORE `createWindow` to avoid mount race (§4.2)
- [x] IPC channel names in §4.3 match existing `CHANNELS` convention
- [x] Magic-byte buffer comparison in §7 uses byte array (`Buffer.equals`), not string coercion
- [x] `fd` cleanup in `finally` is reachable on read-error throw (§7)
- [x] Atomic write in §8.2 includes the directory `fsync` (APFS metadata-reorder guard) + platform note
- [x] `.tmp` orphan recovery on `loadModelsJson` (§8.3)
- [x] Concurrent writes serialized via in-module Promise chain (§7)
- [x] `PickResult.status` is authoritative — renderer never re-fetches `getModelStatus` after pick (§4.4)
- [x] All new strings end with 「。」 and use polite desu/masu form
- [x] No `.bin` / `.gguf` extensions leak into error messages
- [x] App.tsx initial state is `'booting'`, transitions to setup/recording on first status resolve — no Recording flash (§6.1)
- [x] Discord button hidden at runtime if URL contains `<` placeholder (§6.2)
- [x] Env-var override is authoritative (no fall-through to models.json) — pinned in §5.4 and test row 15
- [x] `MODEL_FILE_MOVED` decision documented (unified with `_MISSING_`)
- [x] Mid-session delete out-of-scope explicitly stated (§12)
- [x] Packaged-vs-dev userData divergence (§8.4) called out as expected behavior, not a bug
- [x] Manual smoke in §10.4 includes the picker-cancel branch, Discord placeholder guard, and env-var-missing-file scenarios
