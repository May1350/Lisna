# In-app Model Downloader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On first run, download the two on-device models (from their HuggingFace URLs already in `catalog.ts`) with one button click + progress, replacing the Discord-file-picker flow.

**Architecture:** New `main/model-downloader.ts` streams each `DEFAULT_MODELS` descriptor to `<userData>/models/<filename>` (disk-guard → `.part` → sha256 verify → atomic rename), pushes progress over a new IPC channel, writes `models.json` via the existing `saveModelsJson`, and recomputes status via the existing `resolveModels`. A new renderer `ModelDownloadStep` drives it; the existing `ModelPickerStep` stays as a fallback link.

**Tech Stack:** Electron (main + preload + React renderer), TypeScript, Vitest, `node:crypto` (sha256), `node:fs`, injected `fetchImpl` (global `fetch` in prod).

## Global Constraints

- Version bump: `desktop/package.json` `0.1.36` → `0.1.37` (last task).
- Source of truth for models = `desktop/src/shared/models/catalog.ts` `DEFAULT_MODELS` (`{ stt, llm }`, each `ModelDescriptor { kind, filename, sizeBytes, sha256, source:{url} }`). Do NOT hardcode URLs/hashes elsewhere.
- Error surface = the existing discriminated-union contract: handlers return `{ok:true,...}` | `{ok:false, code}`; NEVER throw raw to the renderer (mirror `models/pick`).
- New error codes MUST be added to BOTH `ALL_ERROR_CODES` and `ERROR_MESSAGE_MAP_JA` in `desktop/src/renderer/i18n/error-message-map.ts` (the map is `Record<ErrorCode,string>` — tsc enforces parity).
- Unit tests mock the network at the injected `fetchImpl` boundary — never hit the real network (testing rule: mock the boundary lib, not the handler).
- Renderer component tests use `renderToStaticMarkup` (no DOM env in this package's vitest).
- JA-only user copy (desu/masu), matching `setup-strings.ts` tone.
- Models save to `<userData>/models/<catalog filename>`; resolver is path-based and UNCHANGED.

---

### Task 1: Downloader core — `downloadModel`

**Files:**
- Create: `desktop/src/main/model-downloader.ts`
- Test: `desktop/src/main/__tests__/model-downloader.test.ts`
- Modify: `desktop/src/renderer/i18n/error-message-map.ts` (add 3 codes + JA copy)

**Interfaces:**
- Consumes: `ModelDescriptor` from `@shared/types`.
- Produces:
  ```ts
  export type DownloadProgress = { received: number; total: number };
  export interface DownloadDeps {
    fetchImpl?: typeof fetch;               // default: globalThis.fetch
    freeBytes?: (dir: string) => number;    // default: statfs-based; injectable for tests
    onProgress?: (p: DownloadProgress) => void;
  }
  // Throws Error with .message ∈ {INSUFFICIENT_DISK, NETWORK_FAILED, CHECKSUM_MISMATCH}
  export async function downloadModel(d: ModelDescriptor, destDir: string, deps?: DownloadDeps): Promise<string>; // returns final path
  ```

- [ ] **Step 1: Write failing tests** (`model-downloader.test.ts`)

```ts
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { downloadModel } from '../model-downloader';
import type { ModelDescriptor } from '@shared/types';

const BODY = Buffer.from('hello-model-bytes');
const SHA = crypto.createHash('sha256').update(BODY).digest('hex');
function desc(over: Partial<ModelDescriptor> = {}): ModelDescriptor {
  return { kind: 'stt', filename: 'm.bin', sizeBytes: BODY.length, sha256: SHA, source: { url: 'https://x/m.bin' }, ...over };
}
// Minimal fetch stub: one-chunk stream body + ok/status.
function okFetch(body = BODY, status = 200): typeof fetch {
  return (async () => ({
    ok: status >= 200 && status < 300, status,
    body: { getReader: () => { let done = false; return { read: async () => done ? { done: true, value: undefined } : (done = true, { done: false, value: new Uint8Array(body) }) }; } },
    headers: new Map([['content-length', String(body.length)]]),
  })) as unknown as typeof fetch;
}
let base: string;
beforeEach(() => { base = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-')); });
afterEach(() => { fs.rmSync(base, { recursive: true, force: true }); });

it('downloads, verifies sha256, atomically writes final file (no .part left)', async () => {
  const seen: number[] = [];
  const p = await downloadModel(desc(), base, { fetchImpl: okFetch(), freeBytes: () => 10e9, onProgress: (x) => seen.push(x.received) });
  expect(p).toBe(path.join(base, 'm.bin'));
  expect(fs.readFileSync(p)).toEqual(BODY);
  expect(fs.existsSync(p + '.part')).toBe(false);
  expect(seen.at(-1)).toBe(BODY.length);
});
it('CHECKSUM_MISMATCH deletes .part and throws', async () => {
  await expect(downloadModel(desc({ sha256: 'deadbeef' }), base, { fetchImpl: okFetch(), freeBytes: () => 10e9 }))
    .rejects.toThrow('CHECKSUM_MISMATCH');
  expect(fs.readdirSync(base)).toEqual([]); // .part cleaned, no final
});
it('non-200 → NETWORK_FAILED', async () => {
  await expect(downloadModel(desc(), base, { fetchImpl: okFetch(BODY, 404), freeBytes: () => 10e9 }))
    .rejects.toThrow('NETWORK_FAILED');
});
it('INSUFFICIENT_DISK when free < size + margin', async () => {
  await expect(downloadModel(desc(), base, { fetchImpl: okFetch(), freeBytes: () => 1 }))
    .rejects.toThrow('INSUFFICIENT_DISK');
});
```

- [ ] **Step 2: Run — verify all fail** (`downloadModel` undefined)

Run: `npx vitest run src/main/__tests__/model-downloader.test.ts`
Expected: FAIL (module not found / not a function).

- [ ] **Step 3: Implement `model-downloader.ts`** — `downloadModel`:
  1. `const need = d.sizeBytes + 512*1024*1024; if ((deps.freeBytes ?? defaultFreeBytes)(destDir) < need) throw new Error('INSUFFICIENT_DISK')`.
  2. `const res = await (deps.fetchImpl ?? fetch)(d.source.url); if (!res.ok || !res.body) throw new Error('NETWORK_FAILED')` (wrap network throw → `NETWORK_FAILED`).
  3. Stream `res.body.getReader()` into `<destDir>/<filename>.part` (write fd), feeding a `crypto.createHash('sha256')`, accumulate `received`, call `onProgress({received, total})` (total from content-length header or `d.sizeBytes`).
  4. `if (hash.digest('hex') !== d.sha256) { rm .part; throw new Error('CHECKSUM_MISMATCH') }`.
  5. `fs.renameSync(part, final); return final`.
  6. `defaultFreeBytes(dir)` = `fs.statfsSync(dir).bavail * fs.statfsSync(dir).bsize`.
  - Ensure `<destDir>` exists (`fs.mkdirSync(destDir, {recursive:true})`).
  - Any thrown error path removes `.part` (try/catch around the stream → cleanup → rethrow).

- [ ] **Step 4: Add error codes** — in `error-message-map.ts`, add `'INSUFFICIENT_DISK'`, `'CHECKSUM_MISMATCH'`, `'NETWORK_FAILED'` to `ALL_ERROR_CODES` and to `ERROR_MESSAGE_MAP_JA` with JA copy, e.g.:
  - `INSUFFICIENT_DISK: 'ディスクの空き容量が足りません。約3GBの空きを確保して再試行してください。'`
  - `CHECKSUM_MISMATCH: 'ダウンロードしたファイルが破損しています。もう一度お試しください。'`
  - `NETWORK_FAILED: 'ダウンロードに失敗しました。接続を確認して再試行してください。'`

- [ ] **Step 5: Run — verify pass**

Run: `npx vitest run src/main/__tests__/model-downloader.test.ts && npx tsc -p tsconfig.json --noEmit`
Expected: 4 passed, tsc clean (ErrorCode map parity).

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(desktop): model-downloader core (stream+sha256+atomic)"`

---

### Task 2: IPC channel + `registerModelDownloadIpc` + preload

**Files:**
- Modify: `desktop/src/main/ipc.ts` (CHANNELS: add `modelDownload: 'models/download'`, `modelDownloadProgress: 'models/download-progress'`)
- Modify: `desktop/src/shared/ipc-protocol.ts` (add `DownloadResult`, `ModelDownloadProgressPayload`)
- Modify: `desktop/src/main/model-downloader.ts` (add `registerModelDownloadIpc`)
- Modify: `desktop/src/main/index.ts` (call `registerModelDownloadIpc` after `registerModelIpc`)
- Modify: `desktop/src/preload/index.ts` (`downloadModels`, `onModelDownloadProgress` + window type)
- Test: `desktop/src/main/__tests__/model-downloader.test.ts` (add IPC describe block)

**Interfaces:**
- Produces:
  ```ts
  // ipc-protocol.ts
  export type DownloadResult = { ok: true; status: ModelStatus } | { ok: false; code: string };
  export interface ModelDownloadProgressPayload { slot: CoreModelSlot; received: number; total: number }
  // model-downloader.ts
  export interface ModelDownloadIpcDeps {
    getMainWindow: () => import('electron').BrowserWindow | undefined;
    userDataDir: string;
    onStatusChange?: (s: ModelStatus) => void;
    downloadImpl?: typeof downloadModel;   // injectable for tests
  }
  export function registerModelDownloadIpc(deps: ModelDownloadIpcDeps): void;
  // preload
  downloadModels(): Promise<DownloadResult>;
  onModelDownloadProgress(cb: (p: ModelDownloadProgressPayload) => void): () => void;
  ```

- [ ] **Step 1: Write failing test** (IPC block, mocks `electron.ipcMain.handle` like `session-finalize.test.ts`; inject `downloadImpl` that resolves fake paths + emits progress):

```ts
// both slots succeed → writes models.json under <userData>/models, onStatusChange(ready)
it('registerModelDownloadIpc: both slots → models.json + ready', async () => {
  // capture ipcMain.handle('models/download'), invoke it with an injected downloadImpl
  // that writes a stub file per descriptor into <userData>/models/<filename> and returns the path,
  // then assert models.json exists with sttPath+llmPath and onStatusChange called with {kind:'ready'}.
});
it('registerModelDownloadIpc: STT download throws → {ok:false, code}, no models.json', async () => { /* ... */ });
```
(Model the `captured` ipcMain-mock harness on `src/main/sidecar/ipc/__tests__/session-finalize.test.ts`. Use a real tmp `userDataDir`.)

- [ ] **Step 2: Run — verify fail.** Run: `npx vitest run src/main/__tests__/model-downloader.test.ts` → FAIL (`registerModelDownloadIpc` undefined).

- [ ] **Step 3: Implement** —
  - `ipc.ts` CHANNELS: add the two channels.
  - `ipc-protocol.ts`: add `DownloadResult` + `ModelDownloadProgressPayload`.
  - `registerModelDownloadIpc`: `ipcMain.handle(CHANNELS.modelDownload, async () => { for slot of ['stt','llm'] { path = await (deps.downloadImpl ?? downloadModel)(DEFAULT_MODELS[slot], join(userDataDir,'models'), { onProgress: p => win.webContents.send(CHANNELS.modelDownloadProgress, { slot, ...p }) }); } saveModelsJson(userDataDir, {version:1, sttPath, llmPath}); status = await resolveModels({userDataDir, envOverride:{}}); onStatusChange?.(status); return {ok:true,status}; })` wrapped in try/catch → `{ok:false, code: err.message}` (map `MODEL_SAVE_FAILED` on save throw).
  - `index.ts`: `registerModelDownloadIpc({ getMainWindow: () => mainWindow, userDataDir, onStatusChange: (s) => { resolveResult = s; } })`.
  - `preload/index.ts`: `downloadModels: () => ipcRenderer.invoke(CHANNELS.modelDownload)` and `onModelDownloadProgress` mirroring `onFinalizeProgress` (on + removeListener cleanup). Add both to the `window.lisna` type block.

- [ ] **Step 4: Run — verify pass.** Run: `npx vitest run src/main/__tests__/model-downloader.test.ts && npx tsc -p tsconfig.json --noEmit` → all pass, tsc clean.

- [ ] **Step 5: Commit** — `git commit -am "feat(desktop): models/download IPC + preload"`

---

### Task 3: Renderer — `ModelDownloadStep` + `SetupView` wiring

**Files:**
- Create: `desktop/src/renderer/components/ModelDownloadStep.tsx`
- Modify: `desktop/src/renderer/i18n/setup-strings.ts` (add download strings)
- Modify: `desktop/src/renderer/routes/SetupView.tsx` (download-first default + fallback link to `ModelPickerStep`)
- Test: `desktop/src/renderer/components/__tests__/ModelDownloadStep.test.tsx`

**Interfaces:**
- Consumes: `window.lisna.downloadModels`, `window.lisna.onModelDownloadProgress`, `DownloadResult`, `ModelStatus`.
- Produces: `ModelDownloadStep({ onReady, onUsePicker }: { onReady: (s: ModelStatus)=>void; onUsePicker: ()=>void })`.

Add to `SETUP_STRINGS_JA`: `downloadTitle: 'AIモデルのダウンロード'`, `downloadBody: (gb) => \`合計 約\${gb}GB・初回のみ。文字起こしモデルとノート生成モデルをダウンロードします。\``, `downloadButton: 'ダウンロード'`, `retryButton: '再試行'`, `usePickerLink: 'すでにファイルがある場合は選択'`, `downloadingStt: '文字起こしモデル', downloadingLlm: 'ノート生成モデル'`.

- [ ] **Step 1: Write failing test** (`renderToStaticMarkup`): idle render shows `downloadButton` copy + `data-testid="download-models"` + a `use-picker` link; (optionally) an error prop renders `data-testid="download-error"` + retry. (Static-only, per package convention; progress/interaction is live-app-verified.)

```tsx
import { renderToStaticMarkup } from 'react-dom/server';
import { ModelDownloadStep } from '../ModelDownloadStep';
it('renders the download button + fallback picker link', () => {
  const html = renderToStaticMarkup(<ModelDownloadStep onReady={() => {}} onUsePicker={() => {}} />);
  expect(html).toContain('download-models');
  expect(html).toContain('ダウンロード');
  expect(html).toContain('use-picker');
});
```

- [ ] **Step 2: Run — verify fail.** Run: `npx vitest run src/renderer/components/__tests__/ModelDownloadStep.test.tsx` → FAIL (no component).

- [ ] **Step 3: Implement** —
  - `ModelDownloadStep.tsx`: `useState` for `{phase:'idle'|'downloading'|'error', progress?, code?}`. Button `data-testid="download-models"` → `window.lisna.downloadModels()`; subscribe `onModelDownloadProgress` in a `useEffect` (cleanup on unmount). On `{ok:true}` → `onReady(status)`; on `{ok:false}` → error phase + `toFriendlyJa(code)` + `[再試行]`. Fallback `<a data-testid="use-picker" onClick={onUsePicker}>`. Disclose size from `DEFAULT_MODELS` sizes (≈2.4).
  - `SetupView.tsx`: default state renders `ModelDownloadStep` (not `ModelPickerStep`); `onReady` → `{kind:'done'}`; `onUsePicker` → switch to the existing picker path. Keep the existing picker code intact.

- [ ] **Step 4: Run — verify pass.** Run: `npx vitest run src/renderer/components/__tests__/ModelDownloadStep.test.tsx && npx tsc -p tsconfig.json --noEmit` → pass + clean.

- [ ] **Step 5: Commit** — `git commit -am "feat(desktop): SetupView download-first UI (ModelDownloadStep)"`

---

### Task 4: Web copy fix (models-latest 404 → auto-download)

**Files:**
- Modify: `web/src/messages/{en,ja,ko}.json` (`downloadPage.*` model-advanced copy)
- Modify: `web/src/app/[locale]/download/page.tsx` (the `#model-files-advanced` section)

- [ ] **Step 1:** Replace the "advanced / `models-latest` / place at `.../models/whisper.bin`" copy with: "Lisna downloads its models automatically on first launch (~2.4 GB, one-time). No manual step." across en/ja/ko (keep key parity). Remove the dead `models-latest` GitHub link + the `.../models/*.bin` path claims.
- [ ] **Step 2:** Run `pnpm --filter lisna-web check:i18n` → 0 violations (key + value parity).
- [ ] **Step 3: Commit** — `git commit -am "fix(web): download page — models auto-download on first launch"`

---

### Task 5: Version bump + full verify

**Files:** Modify `desktop/package.json` version `0.1.36` → `0.1.37`.

- [ ] **Step 1:** Bump version.
- [ ] **Step 2:** Run `pnpm --filter @lisna/desktop typecheck && pnpm --filter @lisna/desktop lint && pnpm --filter @lisna/desktop test` → all green, 0 orphan procs (`pgrep -fl "llama-completion|vitest"`).
- [ ] **Step 3: Commit** — `git commit -am "chore(desktop): 0.1.37 — in-app model downloader"`

---

## Post-plan (operational, NOT plan tasks)
Push (pre-push review gate) → tag `v0.1.37` → release.yml publishes → lisna.jp auto-serves → delete `/Applications/Lisna.app` + re-download 0.1.37.
