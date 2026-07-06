# Onboarding Redesign (smart auto-detect + legal-pad pencil, dark) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the first-run screen to a big, simple, dark hero that auto-detects existing valid models (sha256 vs catalog) and downloads only what's missing, with legal-pad colored-pencil accents (Klee One + `#pencil-rough` SVG filter).

**Architecture:** New `main/model-detect.ts` finds an already-present correct copy per slot (size pre-check → sha256 == catalog); the existing `models/download` handler runs detect-first and downloads only missing slots, then adopts via `saveModelsJson`. The renderer `SetupView`/`ModelDownloadStep` become a centered dark hero (checking → download → done) with pencil accents; the manual `ModelPickerStep` is removed.

**Tech Stack:** Electron (main + preload + React renderer), TypeScript, Vitest, `node:crypto` (sha256), `node:fs`, Klee One (SIL OFL) webfont, inline SVG `feTurbulence`/`feDisplacementMap` filter.

## Global Constraints

- Version bump: `desktop/package.json` `0.1.37` → `0.1.38` (last task).
- Source of truth for models = `desktop/src/shared/models/catalog.ts` `DEFAULT_MODELS` (`{stt,llm}`, each `ModelDescriptor{kind,filename,sizeBytes,sha256,source:{url}}`). No hardcoded URLs/hashes/sizes elsewhere.
- **"Correct latest version" = a file whose sha256 == `DEFAULT_MODELS[slot].sha256`.** Fast-reject with `size === sizeBytes` BEFORE hashing (never hash a wrong-size file). Magic-bytes validation (existing `resolveModels`) is NOT sufficient for version identity.
- Detection candidate order per slot: ① `<userData>/models/<filename>` ② paths from an existing `models.json` and sibling `models.json.freshux-backup` ③ accumulated `<userData>/model-locations.json` (`{stt:string[],llm:string[]}`).
- Error surface unchanged: handler returns `DownloadResult` = `{ok:true,status}` | `{ok:false,code}`; never throw raw to renderer.
- Unit tests mock the boundary (inject `statSize`/`sha256File`/`downloadImpl`/`fetchImpl`) — never real network or real 2 GB hashing. Renderer tests use `renderToStaticMarkup` (no DOM env).
- **Pencil/handwriting is onboarding-only** — never on the recording/notes work surfaces (`web-design.md` scope-boundary). Klee One for handwritten elements (`Lisna`, headline, button label); SF (`--lz-font`) for body/sub. Dark theme only (not the cream paper).
- JA-only user copy, polite desu/masu, matching `setup-strings.ts` tone.
- Run tests FOREGROUND only, scoped (never `run_in_background` — vitest can fork llama subprocesses).

---

### Task 1: Detection core — `model-detect.ts`

**Files:**
- Create: `desktop/src/main/model-detect.ts`
- Test: `desktop/src/main/__tests__/model-detect.test.ts`

**Interfaces:**
- Consumes: `ModelDescriptor` from `@shared/types`; `DEFAULT_MODELS` from `@shared/models/catalog`.
- Produces:
  ```ts
  export interface DetectDeps {
    statSize?: (p: string) => number | null;        // byte size, or null if missing/unreadable
    sha256File?: (p: string) => Promise<string>;    // hex sha256 of file contents
    extraCandidates?: (slot: 'stt' | 'llm') => string[];  // prior/known locations
  }
  export function sha256File(p: string): Promise<string>;
  export function knownLocations(userDataDir: string): { stt: string[]; llm: string[] };
  export function recordLocation(userDataDir: string, slot: 'stt' | 'llm', p: string): void;
  export function priorModelsJsonPaths(userDataDir: string): { stt: string[]; llm: string[] };
  // returns the first candidate path whose size AND sha256 match the catalog descriptor, else null
  export function detectExistingModel(d: ModelDescriptor, userDataDir: string, deps?: DetectDeps): Promise<string | null>;
  ```

- [ ] **Step 1: Write failing tests** (`model-detect.test.ts`)

```ts
import { describe, it, expect, vi } from 'vitest';
import { detectExistingModel } from '../model-detect';
import type { ModelDescriptor } from '@shared/types';

const D: ModelDescriptor = { kind: 'stt', filename: 'm.bin', sizeBytes: 100, sha256: 'goodhash', source: { url: 'x' } };

it('returns the userData path when size AND sha256 match', async () => {
  const sha = vi.fn(async () => 'goodhash');
  const p = await detectExistingModel(D, '/ud', { statSize: (x) => (x === '/ud/models/m.bin' ? 100 : null), sha256File: sha, extraCandidates: () => [] });
  expect(p).toBe('/ud/models/m.bin');
  expect(sha).toHaveBeenCalledOnce();
});

it('fast-rejects on size mismatch WITHOUT hashing', async () => {
  const sha = vi.fn(async () => 'goodhash');
  const p = await detectExistingModel(D, '/ud', { statSize: () => 999, sha256File: sha, extraCandidates: () => [] });
  expect(p).toBeNull();
  expect(sha).not.toHaveBeenCalled();
});

it('returns null when sha256 differs even if size matches', async () => {
  const p = await detectExistingModel(D, '/ud', { statSize: () => 100, sha256File: async () => 'wrong', extraCandidates: () => [] });
  expect(p).toBeNull();
});

it('returns null when the file is missing', async () => {
  const p = await detectExistingModel(D, '/ud', { statSize: () => null, sha256File: async () => 'goodhash', extraCandidates: () => [] });
  expect(p).toBeNull();
});

it('checks userData BEFORE extra candidates and returns the first valid match', async () => {
  const seen: string[] = [];
  const p = await detectExistingModel(D, '/ud', {
    statSize: (x) => { seen.push(x); return 100; },
    sha256File: async (x) => (x === '/prior/m.bin' ? 'goodhash' : 'no'),
    extraCandidates: () => ['/prior/m.bin'],
  });
  expect(seen[0]).toBe('/ud/models/m.bin');   // userData first
  expect(p).toBe('/prior/m.bin');
});
```

- [ ] **Step 2: Run — verify fail.** `cd desktop && npx vitest run src/main/__tests__/model-detect.test.ts` → FAIL (module/function undefined).

- [ ] **Step 3: Implement `model-detect.ts`:**
  - `defaultStatSize(p)` = `try { return fs.statSync(p).size } catch { return null }`.
  - `sha256File(p)` = stream `fs.createReadStream(p)` into `crypto.createHash('sha256')`, resolve hex (reject → let caller treat as miss; wrap so a read error → returns a non-matching sentinel or rejects — prefer: on stream error, resolve to `''` so it just fails the match).
  - `knownLocations(userDataDir)` = read `<userDataDir>/model-locations.json` → `{stt:[],llm:[]}` on any error.
  - `recordLocation(userDataDir, slot, p)` = read, dedup-append `p` to `slot`, write back atomically-ish (`fs.writeFileSync`).
  - `priorModelsJsonPaths(userDataDir)` = read `models.json` and `models.json.freshux-backup` if present; collect `sttPath`/`llmPath` into `{stt:[...],llm:[...]}` (skip missing/parse errors).
  - `detectExistingModel(d, userDataDir, deps)`: build `candidates = [join(userDataDir,'models',d.filename), ...(deps.extraCandidates?.(d.kind) ?? [...priorModelsJsonPaths(userDataDir)[d.kind], ...knownLocations(userDataDir)[d.kind]])]`; for each, `if ((deps.statSize??defaultStatSize)(p) !== d.sizeBytes) continue;` then `if (await (deps.sha256File??sha256File)(p) === d.sha256) return p;`. Return null.

- [ ] **Step 4: Run — verify pass.** `cd desktop && npx vitest run src/main/__tests__/model-detect.test.ts && npx tsc -p tsconfig.json --noEmit` → 5 pass, tsc clean.

- [ ] **Step 5: Commit** — `git add -A desktop/src/main/model-detect.ts desktop/src/main/__tests__/model-detect.test.ts && git commit -m "feat(desktop): model-detect — size+sha256 existing-model detection"`

---

### Task 2: Detect-first in the download handler

**Files:**
- Modify: `desktop/src/main/model-downloader.ts` (`registerModelDownloadIpc`)
- Test: `desktop/src/main/__tests__/model-downloader.test.ts` (extend IPC block)

**Interfaces:**
- Consumes: `detectExistingModel`, `recordLocation` from `../model-detect`; existing `downloadModel`, `DEFAULT_MODELS`, `saveModelsJson`, `resolveModels`.
- Produces: `ModelDownloadIpcDeps` gains an optional `detectImpl?: typeof detectExistingModel` (inject for tests). Behavior: for each slot, `path = await (deps.detectImpl ?? detectExistingModel)(DEFAULT_MODELS[slot], modelsDir-or-userDataDir); if null → download`. Adopt all; `recordLocation` each; return `DownloadResult`.

- [ ] **Step 1: Write failing tests** (extend the IPC `describe`):

```ts
it('both slots detected → NO download, models.json written, onStatusChange(ready)', async () => {
  // register with detectImpl returning a valid path for both slots, downloadImpl = vi.fn (must NOT be called)
  // invoke captured 'models/download' handler; assert downloadImpl not called, models.json exists, onStatusChange called with {kind:'ready'}
});
it('one slot missing → downloads exactly that slot', async () => {
  // detectImpl returns path for stt, null for llm; downloadImpl vi.fn resolves a stub file
  // assert downloadImpl called once for the LLM descriptor only
});
```
(Model the harness on the existing IPC tests in this file; real tmp `userDataDir`.)

- [ ] **Step 2: Run — verify fail.** `cd desktop && npx vitest run src/main/__tests__/model-downloader.test.ts` → FAIL.

- [ ] **Step 3: Implement.** In the `models/download` handler loop, before downloading a slot: `const found = await (deps.detectImpl ?? detectExistingModel)(DEFAULT_MODELS[slot], deps.userDataDir); const finalPath = found ?? await (deps.downloadImpl ?? downloadModel)(DEFAULT_MODELS[slot], join(userDataDir,'models'), {onProgress:...}); recordLocation(userDataDir, slot, finalPath);`. Keep the existing `saveModelsJson` / `resolveModels` / `onStatusChange` / try-catch → `{ok:false,code}` tail unchanged. Progress events fire only for slots that actually download.

- [ ] **Step 4: Run — verify pass.** `cd desktop && npx vitest run src/main/__tests__/model-downloader.test.ts && npx tsc -p tsconfig.json --noEmit` → pass + clean.

- [ ] **Step 5: Commit** — `git commit -am "feat(desktop): models/download detects existing valid models before downloading"`

---

### Task 3: Renderer redesign — dark hero states + copy (no picker)

**Files:**
- Modify: `desktop/src/renderer/components/ModelDownloadStep.tsx`
- Modify: `desktop/src/renderer/routes/SetupView.tsx`
- Modify: `desktop/src/renderer/i18n/setup-strings.ts`
- Modify: `desktop/src/renderer/components/__tests__/ModelDownloadStep.test.tsx`

**Interfaces:**
- Consumes: `window.lisna.downloadModels`, `window.lisna.onModelDownloadProgress`, `DownloadResult`, `ModelStatus`.
- Produces: `ModelDownloadStep({ onReady }: { onReady:(s:ModelStatus)=>void })` — NO `onUsePicker` prop (picker removed). Phase machine `idle | checking | downloading | error`.

Copy — replace picker/Discord strings usage in the onboarding; add to `SETUP_STRINGS_JA`: `wordmark:'Lisna'`, `checkingTitle:'モデルを確認しています'`, `checkingBody:'すでにお使いのモデルがないか調べています…'`, `downloadTitle:'ダウンロードしています'`, `downloadBody2:'初回のみ数分かかります。このままお待ちください。'`, `startButton:'はじめる'`, `startBody:'文字起こしとノート生成のモデルを確認します。必要な場合のみダウンロードします。'`, `sizeDisclosure:(gb)=>\`初回のみ・最大 約\${gb}GB\``, `doneTitle:'準備が完了しました'`, `doneBody:'録音をはじめられます。'`. Keep `downloadingStt`/`downloadingLlm`/`retryButton`.

- [ ] **Step 1: Write failing test** (`renderToStaticMarkup`): idle renders `startButton` copy (`はじめる`) + `data-testid="start"` and does NOT contain `use-picker`; error prop path renders `data-testid="download-retry"`.

```tsx
import { renderToStaticMarkup } from 'react-dom/server';
import { ModelDownloadStep } from '../ModelDownloadStep';
it('renders the start button, no picker link', () => {
  const html = renderToStaticMarkup(<ModelDownloadStep onReady={() => {}} />);
  expect(html).toContain('start');
  expect(html).toContain('はじめる');
  expect(html).not.toContain('use-picker');
});
```

- [ ] **Step 2: Run — verify fail.** `cd desktop && npx vitest run src/renderer/components/__tests__/ModelDownloadStep.test.tsx` → FAIL.

- [ ] **Step 3: Implement.**
  - `ModelDownloadStep`: phase `idle`→ button `data-testid="start"` (`はじめる`) → `handleStart` sets `checking`, calls `window.lisna.downloadModels()`. Subscribe `onModelDownloadProgress` in `useEffect`; when a progress event arrives, flip phase `checking`→`downloading` (keep the late-event guard: only advance from `checking`/`downloading`). On resolve `{ok:true}`→`onReady(status)`; `{ok:false}`→`error` + `toFriendlyJa(code)` + retry (`data-testid="download-retry"`). Idle shows `wordmark` + `startBody` + `sizeDisclosure(TOTAL_GB)` (TOTAL_GB still computed from `DEFAULT_MODELS`). `checking` shows spinner + `checkingTitle`. `downloading` shows the two-segment progress + label. Layout: centered hero (`.lz-onb` container). NO `use-picker` anchor, NO `onUsePicker`.
  - `SetupView`: initial state `{kind:'download'}` renders `<ModelDownloadStep onReady={handleResolved} />` (drop `onUsePicker`, drop the `picker`/`initialError` mount path and the `ModelPickerStep` import if now unused — leave `handleResolved` + `done` redirect intact). Keep `initialStep`/`initialError` props tolerated (or remove if App.tsx updated in Task 5).
  - `setup-strings.ts`: add the new keys above.

- [ ] **Step 4: Run — verify pass.** `cd desktop && npx vitest run src/renderer/components/__tests__/ModelDownloadStep.test.tsx && npx tsc -p tsconfig.json --noEmit` → pass + clean.

- [ ] **Step 5: Commit** — `git commit -am "feat(desktop): onboarding dark hero + checking state, picker removed"`

---

### Task 4: Klee One font + pencil SVG filter + pencil styling (visual)

**Files:**
- Create: `desktop/src/renderer/assets/fonts/KleeOne-Regular.woff2` (bundled font)
- Modify: `desktop/src/renderer/theme.css` (or new `onboarding.css` imported by the renderer) — `@font-face` + `.lz-onb-*` + pencil styles
- Modify: `desktop/src/renderer/App.tsx` — hidden `<svg>` with `#pencil-rough` + `#pencil-grain` filters (once)
- Modify: `desktop/src/renderer/components/ModelDownloadStep.tsx` — apply pencil classes to check / progress / button / wordmark

- [ ] **Step 1:** Obtain **Klee One Regular** woff2 (SIL OFL). Prefer the full font (convert `KleeOne-Regular.ttf` from `github.com/google/fonts/ofl/kleeone` → woff2 via `fonttools`), fallback to a generous `&text=` subset from `fonts.googleapis.com/css2` covering the onboarding strings + common kana. Place at `desktop/src/renderer/assets/fonts/KleeOne-Regular.woff2`. Add `@font-face { font-family:'Klee One'; src:url('./assets/fonts/KleeOne-Regular.woff2') format('woff2'); font-display:swap; }` (adjust the URL to the CSS file's location; ensure electron-vite bundles the asset).

- [ ] **Step 2:** Add the SVG filters to `App.tsx` inside `.lz-app` (hidden `<svg width="0" height="0" style="position:absolute" aria-hidden="true">`), verbatim from `web/src/app/layout.tsx`:
```html
<filter id="pencil-rough" x="-6%" y="-6%" width="112%" height="112%">
  <feTurbulence type="fractalNoise" baseFrequency="0.05 1.2" numOctaves="2" seed="3" result="n"/>
  <feDisplacementMap in="SourceGraphic" in2="n" scale="2.8"/>
</filter>
<filter id="pencil-grain" x="-8%" y="-8%" width="116%" height="116%">
  <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="1" seed="7" result="g"/>
  <feDisplacementMap in="SourceGraphic" in2="g" scale="1.4" result="d"/>
  <feTurbulence type="fractalNoise" baseFrequency="0.04 1.1" numOctaves="2" seed="3" result="r"/>
  <feDisplacementMap in="d" in2="r" scale="2.4"/>
</filter>
```

- [ ] **Step 3:** Add `.lz-onb-*` styles: centered hero (flex column, center, generous padding, fills the content area). `.lz-onb-word` = `font-family:'Klee One'; font-size:40px; color:var(--lz-text); filter:url(#pencil-grain)`. `.lz-onb-hd` = `font-family:'Klee One'`. `.lz-onb-btn` = Klee One label with a hand-drawn burgundy border (SVG `<rect>` overlay with `filter:url(#pencil-rough)`, or a bordered element filtered). Pencil check = inline SVG `<path>` stroke `var(--lz-success)` + `#pencil-grain`, round caps. Pencil progress fill = burgundy `<path>`/bar with `#pencil-grain`. Restraint: only wordmark + check + progress + button border carry pencil (≤4 accents).

- [ ] **Step 4:** Apply the classes/SVGs in `ModelDownloadStep.tsx` for idle (wordmark + button), downloading (pencil progress), done (pencil green check). Keep the Task-3 `data-testid`s intact.

- [ ] **Step 5: Run** — `cd desktop && npx vitest run src/renderer/components/__tests__/ModelDownloadStep.test.tsx && npx tsc -p tsconfig.json --noEmit && npx eslint src/renderer/components/ModelDownloadStep.tsx src/renderer/routes/SetupView.tsx src/renderer/App.tsx` → tests still pass (data-testids intact), tsc + eslint clean. (Visual correctness verified in-app after rebuild, not here.)

- [ ] **Step 6: Commit** — `git add -A desktop/src/renderer/assets/fonts/ desktop/src/renderer/*.css desktop/src/renderer/App.tsx desktop/src/renderer/components/ModelDownloadStep.tsx && git commit -m "feat(desktop): Klee One + pencil accents on onboarding (dark)"`

---

### Task 5: Remove the dead manual picker

**Files:**
- Delete (conditional): `desktop/src/renderer/components/ModelPickerStep.tsx` + its `__tests__`
- Modify: `desktop/src/renderer/i18n/setup-strings.ts` (drop `sttTitle`/`llmTitle`/`body`/`pickButton`/`discordButton`/`DISCORD_CHANNEL_URL`/`isDiscordUrlConfigured` if unused)
- Modify: `desktop/src/renderer/routes/SetupView.tsx` (drop the picker import/state if still present), `desktop/src/renderer/App.tsx` (drop `initialStep`/`initialError` props if now unused)
- Possibly modify: `desktop/src/main/ipc.ts`, `desktop/src/main/model-resolver.ts` (registerModelIpc `models/pick`), `desktop/src/preload/index.ts`, `desktop/src/shared/ipc-protocol.ts` (`PickResult`) — ONLY if `pickModel` has no remaining consumer.

- [ ] **Step 1:** `grep -rn "pickModel\|ModelPickerStep\|models/pick\|PickResult\|DISCORD_CHANNEL_URL\|discordButton\|pick-stt\|pick-llm" desktop/src` — enumerate every consumer. If the ONLY consumers are the picker + its wiring, proceed to delete; if `pickModel` is used elsewhere (e.g. a settings re-pick), keep the IPC and delete only the onboarding picker component.
- [ ] **Step 2:** Delete `ModelPickerStep.tsx` (+ test) and remove the now-unused strings/exports. If `pickModel` is dead, remove the handler registration (`models/pick`), the preload method + its `window.lisna` type entry, `PickResult`, and the `PICKER_CANCELLED`/`MODEL_READ_FAILED` codes only if no longer referenced (tsc will flag `ERROR_MESSAGE_MAP_JA` parity — remove from `ALL_ERROR_CODES` too).
- [ ] **Step 3: Run** — `cd desktop && npx tsc -p tsconfig.json --noEmit && npx eslint src && npx vitest run src/` → clean (no dangling references; any picker tests deleted).
- [ ] **Step 4: Commit** — `git commit -am "chore(desktop): remove dead manual model picker (auto-detect replaces it)"`

---

### Task 6: Version bump 0.1.38 + full verify

**Files:** Modify `desktop/package.json` version `0.1.37` → `0.1.38`.

- [ ] **Step 1:** Bump version.
- [ ] **Step 2:** `cd desktop && pnpm --filter @lisna/desktop typecheck && pnpm --filter @lisna/desktop lint && pnpm --filter @lisna/desktop test` (FOREGROUND) → all green; then `pgrep -fl "llama-completion|vitest" || echo clean` → 0 orphans.
- [ ] **Step 3: Commit** — `git commit -am "chore(desktop): 0.1.38 — onboarding redesign (auto-detect + pencil)"`

---

## Post-plan (operational, NOT plan tasks)
Rebuild `/Applications/Lisna.app` from the branch (lisna-sidecar-rebuild + electron build) → founder smokes `はじめる` → (detect-skip | download) → done, judges Klee One + pencil grain/color → iterate. Then push (pre-push gate) → optionally tag/release 0.1.38.
