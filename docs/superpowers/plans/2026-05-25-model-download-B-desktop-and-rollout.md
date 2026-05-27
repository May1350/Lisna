# Lisna v2 Model Download — Plan B (Desktop + Rollout)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Depends on Plan A** (`2026-05-25-model-download-A-backend.md`) being deployed with `MODEL_DOWNLOAD_ENABLED=off` at minimum. Plan B Phase D flips the flag to `allowlist`.

**Goal:** Ship the desktop side of model-download — main-process `ModelDownloader` + renderer `SetupDownloadView` (4-step wizard + demo Recording UI) + `<userData>` file migration — then roll it out via percentage ramp to all users.

**Architecture:** main-process `ModelDownloader` class drives a strict FSM (`idle → fetching-manifest → downloading → verifying → finalizing → complete`, with `error`/`cancelled` siblings). Renderer reads state via IPC + listens for full-state push events. Wizard collects 4 answers (`uiLang`, `recLang`+`sourceIntent`, `storage`, `licenseAccepted`) persisted in `<userData>/wizard-draft.json` slot-keyed. Telemetry sent with anonymous `device_id` by default; opt-in `user_id` correlation. File rename: `models.json → installed-models.json` in a single atomic boot migration. Picker code (`§5.1`) survives as advanced fallback.

**Tech Stack:** Electron 39 (ESM main) / React 18 / Vite / TypeScript / Vitest (unit) / Playwright (e2e) / next-intl-adapted catalog (`messages-{en,ja,ko}.json` per locale in desktop, NOT web).

**Reference spec:** [`docs/superpowers/specs/2026-05-25-model-download-arch-design.md`](../specs/2026-05-25-model-download-arch-design.md) — §3 FSM, §4 state machine + IPC, §5 lifecycle, §6 rollout.

---

## File structure (Plan B)

### Phase B — Desktop main (Tasks B1-B23)

**Create:**

| Path | Responsibility |
|---|---|
| `desktop/src/main/model-downloader.ts` | `ModelDownloader` class — state machine + downloadSlot + cancel |
| `desktop/src/main/wizard-state.ts` | Load/save/clear `<userData>/wizard-draft.json` + enum-drift defense |
| `desktop/src/main/manifest-cache.ts` | `<userData>/model-manifest.json` + `model-manifest-check.json` ops |
| `desktop/src/main/sha-verify.ts` | `streamHash(filePath)` + `verifyExistingModels(manifest, signal)` |
| `desktop/src/main/telemetry-client.ts` | `emitEvent(event, payload)` → POST /v1/models/download-event |
| `desktop/src/main/device-id.ts` | Load/save `<userData>/telemetry-id.json` UUID |
| `desktop/src/main/settings-store.ts` | `<userData>/settings.json` schema + read/write |
| `desktop/src/main/dismissed-manifests.ts` | `<userData>/dismissed-manifest-versions.json` ops |
| `desktop/src/main/__tests__/*.test.ts` | One test file per module above |

**Modify:**

| Path | Change |
|---|---|
| `desktop/src/main/ipc.ts` | Add CHANNELS + handlers, `RECORDING_ACTIVE` guard, route to ModelDownloader |
| `desktop/src/main/model-resolver.ts` | File rename migration (`models.json → installed-models.json`); rename functions |
| `desktop/src/preload/index.ts` | Expose new APIs on `window.lisna.*` |
| `desktop/src/shared/ipc-protocol.ts` | Types: `DownloadState`, `WizardDraft`, manifest, IPC payloads |
| `desktop/src/main/index.ts` | Wire `ModelDownloader`, register IPC after picker `registerModelIpc` |

### Phase C — Renderer UI (Tasks C1-C20)

**Create:**

| Path | Responsibility |
|---|---|
| `desktop/src/renderer/i18n/messages-en.json` | English catalog |
| `desktop/src/renderer/i18n/messages-ja.json` | Japanese catalog |
| `desktop/src/renderer/i18n/messages-ko.json` | Korean catalog |
| `desktop/src/renderer/i18n/I18nProvider.tsx` | Context + `useT(key)` hook |
| `desktop/src/renderer/routes/SetupDownloadView/index.tsx` | Orchestrator |
| `desktop/src/renderer/routes/SetupDownloadView/PrivacyFooter.tsx` | Fixed on-device privacy line |
| `desktop/src/renderer/routes/SetupDownloadView/LanguagePicker.tsx` | Q1 (self-localized) |
| `desktop/src/renderer/routes/SetupDownloadView/RecordingLangPicker.tsx` | Q2 + source_intent sub-chip |
| `desktop/src/renderer/routes/SetupDownloadView/StoragePicker.tsx` | Q3 + ObsidianExplainer |
| `desktop/src/renderer/routes/SetupDownloadView/LicenseGate.tsx` | Q4 + decline → picker-only mode |
| `desktop/src/renderer/routes/SetupDownloadView/DemoRecordingUI.tsx` | Pre-canned JA demo |
| `desktop/src/renderer/routes/SetupDownloadView/DownloadProgressBanner.tsx` | Sticky banner + CTA |
| `desktop/src/renderer/components/ManifestUpdateBanner.tsx` | Mandatory only |
| `desktop/src/renderer/components/SettingsBadge.tsx` | Non-mandatory badge dot |
| `desktop/src/renderer/components/VaultPathCallout.tsx` | One-shot in NoteView |
| `desktop/src/renderer/routes/SettingsView/Models.tsx` | Installed vs available + update buttons |
| `desktop/src/renderer/routes/SettingsView/Privacy.tsx` | Telemetry identity toggle |
| `desktop/src/renderer/routes/SettingsView/Advanced.tsx` | Relocated §5.1 picker |
| `desktop/src/renderer/routes/PickerOnlyView.tsx` | Post-license-decline landing |
| `desktop/scripts/check-i18n.mjs` | Adapted from web's |
| `desktop/src/renderer/routes/SetupDownloadView/__tests__/*.test.tsx` | Per-component tests (React Testing Library) |

**Modify:**

| Path | Change |
|---|---|
| `desktop/src/renderer/App.tsx` | FSM gains `setup-download` and `picker-only` states |
| `desktop/src/renderer/routes/SetupView.tsx` | Moved into SettingsView/Advanced.tsx (rename + re-import) |
| `desktop/package.json` | Add `check-i18n` script + pre-commit hook entry |

### Phase D — End-to-end (Tasks D1-D6)

**Create:**

| Path | Responsibility |
|---|---|
| `infra/lib/observability-stack.ts` | CloudWatch dashboard `model-download-health` |
| `desktop/docs/founder-smoke-checklist.md` | Manual smoke procedure |

**Modify:**

| Path | Change |
|---|---|
| `infra/lib/api-stack.ts` | Flag flip `off → allowlist` via env (in deploy) |

### Phase E — Polish + rollout (Tasks E1-E6)

**Modify:**

| Path | Change |
|---|---|
| `infra/lib/api-stack.ts` | Bump `MODEL_DOWNLOAD_ROLLOUT_PCT` (`10 → 50 → 100`); then `MODEL_DOWNLOAD_ENABLED=all` |
| `desktop/src/renderer/routes/SettingsView/Advanced.tsx` | Polish picker copy + final label |
| `.claude/rules/architecture.md` | F6 follow-up: add "Desktop model storage" subsection |
| `docs/HANDOFF.md` | Phase-E ship note |

---

## Task list (Phase B — 23 tasks)

Each task is 2-5 minutes per step. Total Phase B estimated engineer time: ~7h.

---

### Task B1: Shared types

**Files:**
- Modify: `desktop/src/shared/ipc-protocol.ts`

- [ ] **Step 1: Read existing types**

Run: `grep -n "ModelSlot\|ResolveResult\|ModelStatus\|PickResult\|CHANNELS" desktop/src/shared/ipc-protocol.ts`
Expected: existing exports including `ModelSlot`, `ResolveResult`, `ModelStatus` from §5.1 picker work. Note their exact shape — we extend, not replace.

- [ ] **Step 2: Add new types**

Append to `desktop/src/shared/ipc-protocol.ts`:

```ts
// ============== Plan B (model download) — added 2026-05-25 ==============

export type CancelReason = 'sign-out' | 'window-close' | 'user-cancel' | 'disk-full' | 'sha-mismatch';

export type DownloadErrorCode =
  | 'NETWORK_OFFLINE'
  | 'MANIFEST_FETCH_FAIL'
  | 'JWT_EXPIRED'
  | 'APP_VERSION_UNSUPPORTED'
  | 'DISK_INSUFFICIENT'
  | 'SHA_MISMATCH'
  | 'FS_WRITE_FAIL'
  | 'R2_5XX'
  | 'CHECKSUM_RETRY_EXHAUSTED'
  | 'RECORDING_ACTIVE';

export type DownloadState =
  | { kind: 'idle' }
  | { kind: 'fetching-manifest' }
  | { kind: 'downloading'; slot: ModelSlot; bytes: number; total: number; etaSec: number; backoffWaitMs?: number; attempt?: number }
  | { kind: 'verifying'; slot: ModelSlot }
  | { kind: 'finalizing'; slot: ModelSlot }
  | { kind: 'complete' }
  | { kind: 'error'; code: DownloadErrorCode; slot?: ModelSlot; message: string; details?: Record<string, unknown> }
  | { kind: 'cancelled'; reason: CancelReason };

export interface ManifestModel {
  slot: ModelSlot;
  id: string;
  version: string;
  size_bytes: number;
  sha256: string;
  tier: 'default' | 'highmem';
  lang: string;
  license_url: string;
  license_id: string;
  license_text_sha256: string;
  url: string;       // signed R2 URL (1h TTL)
}

export interface PublicManifest {
  manifest_version: 1;
  generated_at: string;
  cache_max_age_seconds: number;
  models: ManifestModel[];
}

export interface WizardDraft {
  stepCompleted: 0 | 1 | 2 | 3 | 4;
  answers: {
    uiLang?: 'ja' | 'en' | 'ko' | 'auto';
    recLang?: 'ja' | 'en' | 'ko' | 'multi';
    sourceIntent?: 'meeting' | 'lecture' | 'unset';
    storage?: 'lisna' | 'obsidian' | 'folder';
    licenseAccepted?: { [licenseId: string]: { acceptedAt: string; manifestVersion: number } };
  };
  updatedAt: string;
}

export interface SettingsJson {
  uiLang?: 'ja' | 'en' | 'ko' | 'auto';
  recLang?: 'ja' | 'en' | 'ko' | 'multi';
  sourceIntent?: 'meeting' | 'lecture' | 'unset';
  vault: {
    provider: 'lisna' | 'obsidian' | 'folder';
    vaultPath: string | null;
    firstNotePromptShownAt?: string;
  };
  licenseAccepted: { [licenseId: string]: { acceptedAt: string; manifestVersion: number; licenseTextSha256: string } };
  telemetryIdentifyOptIn: boolean;     // P2.2 — default false
}

export interface ManifestCheckFlag {
  lastCheckedAt: string;
  lastManifestVersion: number;
  mismatchedSlots?: ModelSlot[];
}

// IPC channel name constants (extend existing CHANNELS)
export const NEW_CHANNELS = {
  modelsDownloadStart: 'models/download/start',
  modelsDownloadCancel: 'models/download/cancel',
  modelsDownloadRestart: 'models/download/restart',
  modelsDownloadState: 'models/download/state',
  modelsDownloadStateChanged: 'models/download/state-changed',         // event
  modelsManifestCheck: 'models/manifest/check',
  modelsSidecarReload: 'models/sidecar/reload',
  modelsTelemetryEvent: 'models/telemetry/event',                       // event (renderer → main → POST)
  modelsWizardDraftLoad: 'models/wizard-draft/load',
  modelsWizardDraftSave: 'models/wizard-draft/save',
  modelsWizardDraftClear: 'models/wizard-draft/clear',
  modelsSettingsLoad: 'models/settings/load',
  modelsSettingsSave: 'models/settings/save',
} as const;
```

- [ ] **Step 3: Run typecheck**

Run: `cd desktop && pnpm typecheck`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add desktop/src/shared/ipc-protocol.ts
git commit -m "feat(desktop): add Plan B shared types (DownloadState, manifest, wizard, settings)"
```

---

### Task B2: `device-id.ts` — anonymous telemetry ID

**Files:**
- Create: `desktop/src/main/device-id.ts`
- Test: `desktop/src/main/__tests__/device-id.test.ts`

- [ ] **Step 1: Write failing test**

Create `desktop/src/main/__tests__/device-id.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadOrCreateDeviceId } from '../device-id';

describe('device-id', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'lisna-device-test-'));
  });

  it('creates new UUID on first call', async () => {
    const id = await loadOrCreateDeviceId(tmpDir);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(existsSync(path.join(tmpDir, 'telemetry-id.json'))).toBe(true);
  });

  it('returns same UUID on second call (persisted)', async () => {
    const id1 = await loadOrCreateDeviceId(tmpDir);
    const id2 = await loadOrCreateDeviceId(tmpDir);
    expect(id1).toBe(id2);
  });

  it('rotates ID if file is malformed JSON', async () => {
    require('node:fs').writeFileSync(path.join(tmpDir, 'telemetry-id.json'), '{not-json');
    const id = await loadOrCreateDeviceId(tmpDir);
    expect(id).toMatch(/^[0-9a-f]{8}-/);
    const stored = JSON.parse(readFileSync(path.join(tmpDir, 'telemetry-id.json'), 'utf8'));
    expect(stored.device_id).toBe(id);
  });
});
```

- [ ] **Step 2: Run — verify failure**

Run: `cd desktop && pnpm test device-id.test`
Expected: module not found.

- [ ] **Step 3: Implement**

Create `desktop/src/main/device-id.ts`:

```ts
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

interface Stored { device_id: string; created_at: string; }

export async function loadOrCreateDeviceId(userDataDir: string): Promise<string> {
  const file = path.join(userDataDir, 'telemetry-id.json');
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as Stored;
    if (typeof parsed.device_id === 'string' && /^[0-9a-f-]{36}$/.test(parsed.device_id)) {
      return parsed.device_id;
    }
  } catch { /* fall through to create */ }
  const id = randomUUID();
  await fs.writeFile(file, JSON.stringify({ device_id: id, created_at: new Date().toISOString() }, null, 2));
  return id;
}
```

- [ ] **Step 4: Run — verify pass**

Run: `cd desktop && pnpm test device-id.test`
Expected: 3/3 pass.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/main/device-id.ts desktop/src/main/__tests__/device-id.test.ts
git commit -m "feat(desktop): anonymous device_id load/create for telemetry"
```

---

### Task B3: `settings-store.ts`

**Files:**
- Create: `desktop/src/main/settings-store.ts`
- Test: `desktop/src/main/__tests__/settings-store.test.ts`

- [ ] **Step 1: Write failing test**

Create `desktop/src/main/__tests__/settings-store.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadSettings, saveSettings, DEFAULT_SETTINGS } from '../settings-store';

describe('settings-store', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = mkdtempSync(path.join(os.tmpdir(), 'lisna-settings-test-')); });

  it('returns DEFAULT_SETTINGS when file absent', async () => {
    const s = await loadSettings(tmpDir);
    expect(s).toEqual(DEFAULT_SETTINGS);
  });

  it('persists and reads back', async () => {
    await saveSettings(tmpDir, { ...DEFAULT_SETTINGS, uiLang: 'ja', telemetryIdentifyOptIn: true });
    const s = await loadSettings(tmpDir);
    expect(s.uiLang).toBe('ja');
    expect(s.telemetryIdentifyOptIn).toBe(true);
  });

  it('writes are atomic (tmp + rename)', async () => {
    await saveSettings(tmpDir, { ...DEFAULT_SETTINGS, uiLang: 'ko' });
    expect(existsSync(path.join(tmpDir, 'settings.json.tmp'))).toBe(false);
    const r = JSON.parse(readFileSync(path.join(tmpDir, 'settings.json'), 'utf8'));
    expect(r.uiLang).toBe('ko');
  });

  it('returns DEFAULT_SETTINGS when JSON malformed', async () => {
    require('node:fs').writeFileSync(path.join(tmpDir, 'settings.json'), '{not-json');
    const s = await loadSettings(tmpDir);
    expect(s).toEqual(DEFAULT_SETTINGS);
  });
});
```

- [ ] **Step 2: Run — verify failure**

Run: `cd desktop && pnpm test settings-store.test`
Expected: module not found.

- [ ] **Step 3: Implement**

Create `desktop/src/main/settings-store.ts`:

```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { SettingsJson } from '@shared/ipc-protocol';

export const DEFAULT_SETTINGS: SettingsJson = {
  vault: { provider: 'lisna', vaultPath: null },
  licenseAccepted: {},
  telemetryIdentifyOptIn: false,
};

export async function loadSettings(userDataDir: string): Promise<SettingsJson> {
  const file = path.join(userDataDir, 'settings.json');
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as SettingsJson;
    return { ...DEFAULT_SETTINGS, ...parsed, vault: { ...DEFAULT_SETTINGS.vault, ...(parsed.vault ?? {}) } };
  } catch { return DEFAULT_SETTINGS; }
}

export async function saveSettings(userDataDir: string, settings: SettingsJson): Promise<void> {
  const final = path.join(userDataDir, 'settings.json');
  const tmp = path.join(userDataDir, 'settings.json.tmp');
  const data = JSON.stringify(settings, null, 2);
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, final);
}
```

- [ ] **Step 4: Run — verify pass**

Run: `cd desktop && pnpm test settings-store.test`
Expected: 4/4 pass.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/main/settings-store.ts desktop/src/main/__tests__/settings-store.test.ts
git commit -m "feat(desktop): settings-store with atomic writes + sensible defaults"
```

---

### Task B4: `dismissed-manifests.ts`

**Files:**
- Create: `desktop/src/main/dismissed-manifests.ts`
- Test: `desktop/src/main/__tests__/dismissed-manifests.test.ts`

- [ ] **Step 1: Write failing test**

Create `desktop/src/main/__tests__/dismissed-manifests.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { isDismissed, addDismissal, pruneDismissed } from '../dismissed-manifests';

describe('dismissed-manifests', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = mkdtempSync(path.join(os.tmpdir(), 'lisna-dismiss-test-')); });

  it('isDismissed returns false when file absent', async () => {
    expect(await isDismissed(tmpDir, 5)).toBe(false);
  });

  it('addDismissal then isDismissed returns true', async () => {
    await addDismissal(tmpDir, 5);
    expect(await isDismissed(tmpDir, 5)).toBe(true);
  });

  it('isDismissed of unmentioned version returns false', async () => {
    await addDismissal(tmpDir, 5);
    expect(await isDismissed(tmpDir, 6)).toBe(false);
  });

  it('pruneDismissed removes entries < currentVersion - 10', async () => {
    for (const v of [1, 2, 3, 15, 16, 17]) await addDismissal(tmpDir, v);
    await pruneDismissed(tmpDir, 18);
    const after = JSON.parse(readFileSync(path.join(tmpDir, 'dismissed-manifest-versions.json'), 'utf8'));
    expect(after.versions.sort()).toEqual([15, 16, 17]);   // 1,2,3 pruned (< 18-10=8)
  });

  it('caps total entries at 50', async () => {
    for (let v = 1; v <= 60; v++) await addDismissal(tmpDir, v);
    const after = JSON.parse(readFileSync(path.join(tmpDir, 'dismissed-manifest-versions.json'), 'utf8'));
    expect(after.versions.length).toBe(50);
    expect(Math.min(...after.versions)).toBe(11);          // oldest 10 trimmed
  });
});
```

- [ ] **Step 2: Run — verify failure**

Run: `cd desktop && pnpm test dismissed-manifests.test`
Expected: module not found.

- [ ] **Step 3: Implement**

Create `desktop/src/main/dismissed-manifests.ts`:

```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';

interface Stored { versions: number[]; }

const CAP = 50;
const PRUNE_MARGIN = 10;

async function read(dir: string): Promise<number[]> {
  try {
    const raw = await fs.readFile(path.join(dir, 'dismissed-manifest-versions.json'), 'utf8');
    const parsed = JSON.parse(raw) as Stored;
    return Array.isArray(parsed.versions) ? parsed.versions : [];
  } catch { return []; }
}

async function write(dir: string, versions: number[]): Promise<void> {
  const final = path.join(dir, 'dismissed-manifest-versions.json');
  const tmp = final + '.tmp';
  await fs.writeFile(tmp, JSON.stringify({ versions }, null, 2));
  await fs.rename(tmp, final);
}

export async function isDismissed(dir: string, version: number): Promise<boolean> {
  const versions = await read(dir);
  return versions.includes(version);
}

export async function addDismissal(dir: string, version: number): Promise<void> {
  const versions = await read(dir);
  if (versions.includes(version)) return;
  versions.push(version);
  versions.sort((a, b) => a - b);
  // Cap at 50 entries by trimming oldest
  while (versions.length > CAP) versions.shift();
  await write(dir, versions);
}

export async function pruneDismissed(dir: string, currentVersion: number): Promise<void> {
  const versions = await read(dir);
  const cutoff = currentVersion - PRUNE_MARGIN;
  const kept = versions.filter(v => v >= cutoff);
  if (kept.length !== versions.length) await write(dir, kept);
}
```

- [ ] **Step 4: Run — verify pass**

Run: `cd desktop && pnpm test dismissed-manifests.test`
Expected: 5/5 pass.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/main/dismissed-manifests.ts desktop/src/main/__tests__/dismissed-manifests.test.ts
git commit -m "feat(desktop): dismissed-manifests with 50-cap + prune margin"
```

---

### Task B5: `manifest-cache.ts`

**Files:**
- Create: `desktop/src/main/manifest-cache.ts`
- Test: `desktop/src/main/__tests__/manifest-cache.test.ts`

- [ ] **Step 1: Write failing test**

Create `desktop/src/main/__tests__/manifest-cache.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readCachedManifest, writeCachedManifest, readCheckFlag, writeCheckFlag, isFresh } from '../manifest-cache';
import type { PublicManifest } from '@shared/ipc-protocol';

const sample: PublicManifest = {
  manifest_version: 1,
  generated_at: '2026-05-25T00:00:00Z',
  cache_max_age_seconds: 604800,
  models: [],
};

describe('manifest-cache', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = mkdtempSync(path.join(os.tmpdir(), 'lisna-mcache-test-')); });

  it('readCachedManifest returns null when absent', async () => {
    expect(await readCachedManifest(tmpDir)).toBeNull();
  });

  it('write then read', async () => {
    await writeCachedManifest(tmpDir, sample);
    const r = await readCachedManifest(tmpDir);
    expect(r?.manifest_version).toBe(1);
  });

  it('readCheckFlag returns null when absent', async () => {
    expect(await readCheckFlag(tmpDir)).toBeNull();
  });

  it('write + read check flag', async () => {
    const flag = { lastCheckedAt: new Date().toISOString(), lastManifestVersion: 1 };
    await writeCheckFlag(tmpDir, flag);
    expect((await readCheckFlag(tmpDir))?.lastManifestVersion).toBe(1);
  });

  it('isFresh returns true if within TTL', () => {
    expect(isFresh({ lastCheckedAt: new Date().toISOString(), lastManifestVersion: 1 }, 3600)).toBe(true);
  });

  it('isFresh returns false if outside TTL', () => {
    const old = new Date(Date.now() - 7200 * 1000).toISOString();
    expect(isFresh({ lastCheckedAt: old, lastManifestVersion: 1 }, 3600)).toBe(false);
  });
});
```

- [ ] **Step 2: Run — verify failure**

Run: `cd desktop && pnpm test manifest-cache.test`
Expected: module not found.

- [ ] **Step 3: Implement**

Create `desktop/src/main/manifest-cache.ts`:

```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { PublicManifest, ManifestCheckFlag } from '@shared/ipc-protocol';

async function readJsonOrNull<T>(file: string): Promise<T | null> {
  try { return JSON.parse(await fs.readFile(file, 'utf8')) as T; } catch { return null; }
}

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  const tmp = file + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(value, null, 2));
  await fs.rename(tmp, file);
}

export const readCachedManifest = (dir: string) => readJsonOrNull<PublicManifest>(path.join(dir, 'model-manifest.json'));
export const writeCachedManifest = (dir: string, m: PublicManifest) => writeJsonAtomic(path.join(dir, 'model-manifest.json'), m);

export const readCheckFlag = (dir: string) => readJsonOrNull<ManifestCheckFlag>(path.join(dir, 'model-manifest-check.json'));
export const writeCheckFlag = (dir: string, f: ManifestCheckFlag) => writeJsonAtomic(path.join(dir, 'model-manifest-check.json'), f);

export function isFresh(flag: ManifestCheckFlag, ttlSeconds: number): boolean {
  const last = new Date(flag.lastCheckedAt).getTime();
  return (Date.now() - last) / 1000 < ttlSeconds;
}
```

- [ ] **Step 4: Run — verify pass**

Run: `cd desktop && pnpm test manifest-cache.test`
Expected: 6/6 pass.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/main/manifest-cache.ts desktop/src/main/__tests__/manifest-cache.test.ts
git commit -m "feat(desktop): manifest-cache + check-flag with atomic writes + TTL"
```

---

### Task B6: `sha-verify.ts` — streamHash

**Files:**
- Create: `desktop/src/main/sha-verify.ts`
- Test: `desktop/src/main/__tests__/sha-verify.test.ts`

- [ ] **Step 1: Write failing test**

Create `desktop/src/main/__tests__/sha-verify.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { streamHash } from '../sha-verify';

describe('sha-verify — streamHash', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = mkdtempSync(path.join(os.tmpdir(), 'lisna-sha-test-')); });

  it('hashes a known file', async () => {
    const file = path.join(tmpDir, 'a.bin');
    writeFileSync(file, 'hello world');
    const sha = await streamHash(file, new AbortController().signal);
    // sha256 of "hello world"
    expect(sha).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
  });

  it('aborts mid-hash', async () => {
    const file = path.join(tmpDir, 'big.bin');
    writeFileSync(file, Buffer.alloc(50_000_000, 0));    // 50 MB
    const ac = new AbortController();
    queueMicrotask(() => ac.abort());                      // immediate abort
    await expect(streamHash(file, ac.signal)).rejects.toThrow(/abort/i);
  });
});
```

- [ ] **Step 2: Run — verify failure**

Run: `cd desktop && pnpm test sha-verify.test`
Expected: module not found.

- [ ] **Step 3: Implement (streamHash only — verifyExistingModels in Task B7)**

Create `desktop/src/main/sha-verify.ts`:

```ts
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

export async function streamHash(filePath: string, signal: AbortSignal): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    const onAbort = () => {
      stream.destroy(new Error('aborted'));
      reject(new Error('aborted'));
    };
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });

    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => {
      signal.removeEventListener('abort', onAbort);
      resolve(hash.digest('hex'));
    });
    stream.on('error', (err) => {
      signal.removeEventListener('abort', onAbort);
      reject(err);
    });
  });
}
```

- [ ] **Step 4: Run — verify pass**

Run: `cd desktop && pnpm test sha-verify.test`
Expected: 2/2 pass.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/main/sha-verify.ts desktop/src/main/__tests__/sha-verify.test.ts
git commit -m "feat(desktop): sha-verify.streamHash with AbortSignal support"
```

---

### Task B7: `verifyExistingModels` (migration helper)

**Files:**
- Modify: `desktop/src/main/sha-verify.ts`
- Test: extend `desktop/src/main/__tests__/sha-verify.test.ts`

- [ ] **Step 1: Append failing test**

Append to `desktop/src/main/__tests__/sha-verify.test.ts`:

```ts
import { verifyExistingModels } from '../sha-verify';
import type { PublicManifest } from '@shared/ipc-protocol';

describe('sha-verify — verifyExistingModels', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = mkdtempSync(path.join(os.tmpdir(), 'lisna-vem-test-')); });

  it('returns matched + mismatched per slot', async () => {
    const sttFile = path.join(tmpDir, 'whisper.bin');
    const llmFile = path.join(tmpDir, 'llm.gguf');
    writeFileSync(sttFile, 'stt-bytes');
    writeFileSync(llmFile, 'llm-bytes');
    const sttSha = await streamHash(sttFile, new AbortController().signal);
    const llmSha = 'wrong-sha-' + '0'.repeat(50);

    const manifest: PublicManifest = {
      manifest_version: 1, generated_at: '2026-05-25T00:00:00Z', cache_max_age_seconds: 0,
      models: [
        { slot: 'stt', id: 's', version: '1', size_bytes: 0, sha256: sttSha, tier: 'default', lang: 'ja', license_url: '', license_id: '', license_text_sha256: '', url: '' },
        { slot: 'llm', id: 'l', version: '1', size_bytes: 0, sha256: llmSha, tier: 'default', lang: 'multi', license_url: '', license_id: '', license_text_sha256: '', url: '' },
      ],
    };
    const installed = { stt: sttFile, llm: llmFile };
    const result = await verifyExistingModels({ manifest, installed, signal: new AbortController().signal });
    expect(result.matched).toEqual(['stt']);
    expect(result.mismatched).toEqual(['llm']);
  });

  it('skips slots without installed path', async () => {
    const manifest: PublicManifest = {
      manifest_version: 1, generated_at: '', cache_max_age_seconds: 0,
      models: [{ slot: 'stt', id: 's', version: '', size_bytes: 0, sha256: 'x', tier: 'default', lang: 'ja', license_url: '', license_id: '', license_text_sha256: '', url: '' }],
    };
    const result = await verifyExistingModels({ manifest, installed: { stt: '', llm: '' }, signal: new AbortController().signal });
    expect(result.matched).toEqual([]);
    expect(result.mismatched).toEqual([]);
  });

  it('skips .partial files in installed paths', async () => {
    const partial = path.join(tmpDir, 'whisper.bin.partial');
    writeFileSync(partial, 'x');
    const manifest: PublicManifest = {
      manifest_version: 1, generated_at: '', cache_max_age_seconds: 0,
      models: [{ slot: 'stt', id: 's', version: '', size_bytes: 0, sha256: 'x', tier: 'default', lang: 'ja', license_url: '', license_id: '', license_text_sha256: '', url: '' }],
    };
    const result = await verifyExistingModels({ manifest, installed: { stt: partial, llm: '' }, signal: new AbortController().signal });
    expect(result.matched).toEqual([]);
    expect(result.mismatched).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — verify failure**

Run: `cd desktop && pnpm test sha-verify.test`
Expected: 3 new failures.

- [ ] **Step 3: Append implementation**

Append to `desktop/src/main/sha-verify.ts`:

```ts
import type { PublicManifest, ModelSlot } from '@shared/ipc-protocol';

export interface VerifyResult {
  matched: ModelSlot[];
  mismatched: ModelSlot[];
}

export interface VerifyInput {
  manifest: PublicManifest;
  installed: { stt?: string; llm?: string };   // absolute paths
  signal: AbortSignal;
}

export async function verifyExistingModels(input: VerifyInput): Promise<VerifyResult> {
  const matched: ModelSlot[] = [];
  const mismatched: ModelSlot[] = [];
  for (const m of input.manifest.models) {
    if (input.signal.aborted) break;
    const filePath = input.installed[m.slot];
    if (!filePath) continue;
    if (filePath.endsWith('.partial')) continue;        // never SHA-check partials
    let actual: string;
    try {
      actual = await streamHash(filePath, input.signal);
    } catch {
      continue;                                          // file unreadable; skip
    }
    (actual === m.sha256 ? matched : mismatched).push(m.slot);
  }
  return { matched, mismatched };
}
```

- [ ] **Step 4: Run — verify pass**

Run: `cd desktop && pnpm test sha-verify.test`
Expected: 5/5 pass.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/main/sha-verify.ts desktop/src/main/__tests__/sha-verify.test.ts
git commit -m "feat(desktop): verifyExistingModels for v0.1.x migration adoption"
```

---

### Task B8: `wizard-state.ts`

**Files:**
- Create: `desktop/src/main/wizard-state.ts`
- Test: `desktop/src/main/__tests__/wizard-state.test.ts`

- [ ] **Step 1: Write failing test**

Create `desktop/src/main/__tests__/wizard-state.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, utimesSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadWizardDraft, saveWizardDraft, clearWizardDraft } from '../wizard-state';

describe('wizard-state', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = mkdtempSync(path.join(os.tmpdir(), 'lisna-wizard-test-')); });

  it('loadWizardDraft returns null when absent', async () => {
    expect(await loadWizardDraft(tmpDir)).toBeNull();
  });

  it('save + load roundtrip', async () => {
    await saveWizardDraft(tmpDir, { stepCompleted: 2, answers: { uiLang: 'ja', recLang: 'ja' }, updatedAt: new Date().toISOString() });
    const d = await loadWizardDraft(tmpDir);
    expect(d?.stepCompleted).toBe(2);
    expect(d?.answers.uiLang).toBe('ja');
  });

  it('clears existing draft', async () => {
    await saveWizardDraft(tmpDir, { stepCompleted: 1, answers: { uiLang: 'ja' }, updatedAt: new Date().toISOString() });
    await clearWizardDraft(tmpDir);
    expect(await loadWizardDraft(tmpDir)).toBeNull();
  });

  it('purges drafts > 30 days old', async () => {
    const file = path.join(tmpDir, 'wizard-draft.json');
    await saveWizardDraft(tmpDir, { stepCompleted: 2, answers: { uiLang: 'ja' }, updatedAt: new Date().toISOString() });
    const old = (Date.now() - 31 * 86400 * 1000) / 1000;
    utimesSync(file, old, old);
    expect(await loadWizardDraft(tmpDir)).toBeNull();
  });

  it('drops unknown enum values + clamps stepCompleted (drift defense)', async () => {
    require('node:fs').writeFileSync(
      path.join(tmpDir, 'wizard-draft.json'),
      JSON.stringify({ stepCompleted: 3, answers: { uiLang: 'ja', storage: 'WAS-RENAMED' }, updatedAt: new Date().toISOString() }, null, 2),
    );
    const d = await loadWizardDraft(tmpDir);
    expect(d?.answers.storage).toBeUndefined();
    expect(d?.stepCompleted).toBeLessThan(3);
  });
});
```

- [ ] **Step 2: Run — verify failure**

Run: `cd desktop && pnpm test wizard-state.test`
Expected: module not found.

- [ ] **Step 3: Implement**

Create `desktop/src/main/wizard-state.ts`:

```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { WizardDraft } from '@shared/ipc-protocol';

const FILE = 'wizard-draft.json';
const MAX_AGE_MS = 30 * 86400 * 1000;

const ENUMS = {
  uiLang: new Set(['ja', 'en', 'ko', 'auto']),
  recLang: new Set(['ja', 'en', 'ko', 'multi']),
  sourceIntent: new Set(['meeting', 'lecture', 'unset']),
  storage: new Set(['lisna', 'obsidian', 'folder']),
};
const STEP_INDEX: Record<string, number> = { uiLang: 1, recLang: 2, sourceIntent: 2, storage: 3 };
// licenseAccepted has no step gate; defaults to allowed.

function defendDrift(draft: WizardDraft): WizardDraft {
  const result: WizardDraft = { ...draft, answers: { ...draft.answers } };
  for (const key of Object.keys(result.answers) as (keyof WizardDraft['answers'])[]) {
    const allowed = (ENUMS as any)[key];
    if (!allowed) continue;
    const value = (result.answers as any)[key];
    if (typeof value === 'string' && !allowed.has(value)) {
      delete (result.answers as any)[key];
      const minStep = (STEP_INDEX[key] ?? 1) - 1;
      result.stepCompleted = Math.min(result.stepCompleted, minStep) as 0 | 1 | 2 | 3 | 4;
    }
  }
  return result;
}

export async function loadWizardDraft(userDataDir: string): Promise<WizardDraft | null> {
  const file = path.join(userDataDir, FILE);
  try {
    const stat = await fs.stat(file);
    if (Date.now() - stat.mtimeMs > MAX_AGE_MS) {
      await fs.unlink(file).catch(() => {});
      return null;
    }
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as WizardDraft;
    return defendDrift(parsed);
  } catch {
    return null;
  }
}

export async function saveWizardDraft(userDataDir: string, draft: WizardDraft): Promise<void> {
  const final = path.join(userDataDir, FILE);
  const tmp = final + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(draft, null, 2));
  await fs.rename(tmp, final);
}

export async function clearWizardDraft(userDataDir: string): Promise<void> {
  await fs.unlink(path.join(userDataDir, FILE)).catch(() => {});
}
```

- [ ] **Step 4: Run — verify pass**

Run: `cd desktop && pnpm test wizard-state.test`
Expected: 5/5 pass.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/main/wizard-state.ts desktop/src/main/__tests__/wizard-state.test.ts
git commit -m "feat(desktop): wizard-state load/save/clear + 30d purge + enum-drift defense"
```

---

### Task B9: `telemetry-client.ts`

**Files:**
- Create: `desktop/src/main/telemetry-client.ts`
- Test: `desktop/src/main/__tests__/telemetry-client.test.ts`

- [ ] **Step 1: Write failing test**

Create `desktop/src/main/__tests__/telemetry-client.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendTelemetryEvent } from '../telemetry-client';

const fetchMock = vi.fn();
global.fetch = fetchMock as any;

describe('telemetry-client', () => {
  beforeEach(() => fetchMock.mockReset());

  it('POSTs with device_id, no JWT when opt-in is false', async () => {
    fetchMock.mockResolvedValue({ status: 204 });
    await sendTelemetryEvent({
      apiBase: 'https://api.test',
      jwt: 'jwt-token',
      optInIdentify: false,
      deviceId: 'device-uuid',
      appVersion: '0.2.0',
      osFamily: 'macos-26',
      arch: 'arm64',
      sourceIntent: 'lecture',
      event: 'download.complete',
      payload: { slot: 'stt' },
      userAgent: 'Lisna/v0.2.0',
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.device_id).toBe('device-uuid');
    expect(init.headers['X-Lisna-Telemetry-Identify']).toBeUndefined();
    expect(init.headers['User-Agent']).toBe('Lisna/v0.2.0');
  });

  it('adds X-Lisna-Telemetry-Identify when opt-in true', async () => {
    fetchMock.mockResolvedValue({ status: 204 });
    await sendTelemetryEvent({
      apiBase: 'https://api.test', jwt: 'jwt', optInIdentify: true,
      deviceId: 'd', appVersion: '0.2.0', osFamily: 'macos-26', arch: 'arm64',
      sourceIntent: 'unset', event: 'manifest.fetch.success', payload: {},
      userAgent: 'Lisna/v0.2.0',
    });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['X-Lisna-Telemetry-Identify']).toBe('1');
    expect(init.headers['Authorization']).toBe('Bearer jwt');
  });

  it('times out after 5s — does not throw, just logs', async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));    // never resolves
    const start = Date.now();
    await sendTelemetryEvent({
      apiBase: 'https://api.test', jwt: 'jwt', optInIdentify: false,
      deviceId: 'd', appVersion: '0.2.0', osFamily: 'macos-26', arch: 'arm64',
      sourceIntent: 'unset', event: 'manifest.fetch.success', payload: {},
      userAgent: 'Lisna/v0.2.0',
    });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThan(4800);
    expect(elapsed).toBeLessThan(6000);
  }, 7000);
});
```

- [ ] **Step 2: Run — verify failure**

Run: `cd desktop && pnpm test telemetry-client.test`
Expected: module not found.

- [ ] **Step 3: Implement**

Create `desktop/src/main/telemetry-client.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { log } from './log';

export interface TelemetryInput {
  apiBase: string;
  jwt: string;
  optInIdentify: boolean;
  deviceId: string;
  appVersion: string;
  osFamily: string;
  arch: string;
  sourceIntent: 'meeting' | 'lecture' | 'unset';
  event: string;
  payload: Record<string, unknown>;
  userAgent: string;
}

const TIMEOUT_MS = 5000;

export async function sendTelemetryEvent(input: TelemetryInput): Promise<void> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${input.jwt}`,
    'User-Agent': input.userAgent,
  };
  if (input.optInIdentify) headers['X-Lisna-Telemetry-Identify'] = '1';

  const body = JSON.stringify({
    event: input.event,
    event_id: randomUUID(),
    timestamp: new Date().toISOString(),
    device_id: input.deviceId,
    app_version: input.appVersion,
    os_family: input.osFamily,
    arch: input.arch,
    source_intent: input.sourceIntent,
    payload: input.payload,
  });

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${input.apiBase}/v1/models/download-event`, {
      method: 'POST', headers, body, signal: ac.signal,
    });
    if (res.status >= 400) {
      log.warn(`[telemetry] event ${input.event} rejected: status=${res.status}`);
    }
  } catch (e) {
    // Best-effort: never throw, telemetry must not block UX
    log.warn(`[telemetry] event ${input.event} send failed:`, (e as Error).message);
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Run — verify pass**

Run: `cd desktop && pnpm test telemetry-client.test`
Expected: 3/3 pass.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/main/telemetry-client.ts desktop/src/main/__tests__/telemetry-client.test.ts
git commit -m "feat(desktop): telemetry-client best-effort POST + 5s timeout"
```

---

### Task B10: `ModelDownloader` skeleton + state-machine plumbing

**Files:**
- Create: `desktop/src/main/model-downloader.ts`
- Test: `desktop/src/main/__tests__/model-downloader.test.ts`

This task adds the class shell + state-changed event emitter. Slot-download logic in B11.

- [ ] **Step 1: Write failing test**

Create `desktop/src/main/__tests__/model-downloader.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { ModelDownloader } from '../model-downloader';

describe('ModelDownloader (skeleton)', () => {
  it('starts in idle state', () => {
    const d = new ModelDownloader({} as any);
    expect(d.getState()).toEqual({ kind: 'idle' });
  });

  it('emits state on subscribers', () => {
    const d = new ModelDownloader({} as any);
    const seen: any[] = [];
    const unsub = d.onState(s => seen.push(s));
    (d as any).setState({ kind: 'fetching-manifest' });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ kind: 'fetching-manifest' });
    unsub();
    (d as any).setState({ kind: 'idle' });
    expect(seen).toHaveLength(1);                  // unsubscribed
  });

  it('cancel sets state to cancelled with reason', () => {
    const d = new ModelDownloader({} as any);
    (d as any).setState({ kind: 'fetching-manifest' });
    d.cancel('user-cancel');
    expect(d.getState()).toEqual({ kind: 'cancelled', reason: 'user-cancel' });
  });
});
```

- [ ] **Step 2: Run — verify failure**

Run: `cd desktop && pnpm test model-downloader.test`
Expected: module not found.

- [ ] **Step 3: Implement skeleton**

Create `desktop/src/main/model-downloader.ts`:

```ts
import type { DownloadState, CancelReason } from '@shared/ipc-protocol';
import { log } from './log';

export interface ModelDownloaderDeps {
  userDataDir: string;
  apiBase: string;
  getJwt: () => Promise<string | null>;
  appVersion: string;
  osFamily: string;
  arch: string;
  recordingActive: () => boolean;
  onSidecarReload: () => Promise<void>;
}

export class ModelDownloader {
  private state: DownloadState = { kind: 'idle' };
  private subscribers = new Set<(s: DownloadState) => void>();
  private abortController: AbortController | null = null;

  constructor(private deps: ModelDownloaderDeps) {}

  getState(): DownloadState { return this.state; }

  onState(cb: (s: DownloadState) => void): () => void {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }

  protected setState(next: DownloadState): void {
    this.state = next;
    for (const cb of this.subscribers) cb(next);
    log.info('[downloader] state:', next.kind);
  }

  cancel(reason: CancelReason): void {
    if (this.state.kind === 'finalizing') return;          // uninterruptible
    if (this.abortController) this.abortController.abort();
    this.setState({ kind: 'cancelled', reason });
  }

  async start(): Promise<void> {
    // Implementation in subsequent tasks. Skeleton throws so we notice if invoked early.
    throw new Error('ModelDownloader.start() not yet implemented (Task B11+)');
  }

  async restart(): Promise<void> {
    this.setState({ kind: 'idle' });
    return this.start();
  }
}
```

- [ ] **Step 4: Run — verify pass**

Run: `cd desktop && pnpm test model-downloader.test`
Expected: 3/3 pass.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/main/model-downloader.ts desktop/src/main/__tests__/model-downloader.test.ts
git commit -m "feat(desktop): ModelDownloader skeleton (state + subscribers + cancel)"
```

---

### Task B11: ModelDownloader — manifest fetch + disk pre-check

**Files:**
- Modify: `desktop/src/main/model-downloader.ts`
- Extend: `desktop/src/main/__tests__/model-downloader.test.ts`

This adds `fetchManifest` + `checkDisk` calls to `start()`. Per-slot download logic in B12.

- [ ] **Step 1: Append failing tests**

Append to `desktop/src/main/__tests__/model-downloader.test.ts`:

```ts
import { vi } from 'vitest';

describe('ModelDownloader.start — manifest + disk', () => {
  it('transitions through fetching-manifest then errors on manifest fetch fail', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('NETWORK_FAIL'));
    global.fetch = fetchMock as any;
    const d = new ModelDownloader({
      userDataDir: '/tmp/x', apiBase: 'https://api.test',
      getJwt: async () => 'jwt',
      appVersion: '0.2.0', osFamily: 'macos-26', arch: 'arm64',
      recordingActive: () => false, onSidecarReload: async () => {},
    });
    await d.start().catch(() => {});
    expect(d.getState().kind).toBe('error');
    if (d.getState().kind === 'error') {
      expect((d.getState() as any).code).toBe('MANIFEST_FETCH_FAIL');
    }
  });

  it('rejects with RECORDING_ACTIVE error when recordingActive=true', async () => {
    const d = new ModelDownloader({
      userDataDir: '/tmp/x', apiBase: 'https://api.test', getJwt: async () => 'jwt',
      appVersion: '0.2.0', osFamily: 'macos-26', arch: 'arm64',
      recordingActive: () => true, onSidecarReload: async () => {},
    });
    await expect(d.start()).rejects.toThrow('RECORDING_ACTIVE');
  });
});
```

- [ ] **Step 2: Implement start() up through manifest + disk**

Modify `desktop/src/main/model-downloader.ts` — replace `start()` body:

```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { writeCachedManifest } from './manifest-cache';
import type { PublicManifest } from '@shared/ipc-protocol';

// ... (existing class body)

async start(): Promise<void> {
  if (this.deps.recordingActive()) {
    throw Object.assign(new Error('RECORDING_ACTIVE'), { code: 'RECORDING_ACTIVE' });
  }
  this.abortController = new AbortController();
  const signal = this.abortController.signal;

  // 1. Fetch manifest
  this.setState({ kind: 'fetching-manifest' });
  let manifest: PublicManifest;
  try {
    const jwt = await this.deps.getJwt();
    if (!jwt) return this.setState({ kind: 'error', code: 'JWT_EXPIRED', message: 'JWT_EXPIRED' });
    const res = await this.fetchManifestWithBackoff(jwt, signal);
    manifest = res;
    await writeCachedManifest(this.deps.userDataDir, manifest);
  } catch (e) {
    if (signal.aborted) return this.setState({ kind: 'cancelled', reason: 'user-cancel' });
    return this.setState({ kind: 'error', code: 'MANIFEST_FETCH_FAIL', message: (e as Error).message });
  }

  // 2. Disk pre-check
  const required = manifest.models.reduce((s, m) => s + m.size_bytes, 0) * 1.1 + 1_073_741_824;
  const free = await this.getFreeBytes(this.deps.userDataDir);
  if (free < required) {
    return this.setState({
      kind: 'error', code: 'DISK_INSUFFICIENT',
      message: `Need ${Math.ceil(required / 2**30)} GB, only ${Math.floor(free / 2**30)} GB free`,
      details: { needed: required, available: free },
    });
  }

  // 3. Sequential STT then LLM (B12 fills this in)
  for (const m of manifest.models) {
    if (signal.aborted) return this.setState({ kind: 'cancelled', reason: 'user-cancel' });
    // TODO Task B12 — downloadSlot(m, signal); break on error.
  }
  this.setState({ kind: 'complete' });
  await this.deps.onSidecarReload();
}

private async fetchManifestWithBackoff(jwt: string, signal: AbortSignal): Promise<PublicManifest> {
  const backoffs = [0, 1000, 2000, 4000];
  let lastErr: Error | null = null;
  for (let i = 0; i < backoffs.length; i++) {
    if (signal.aborted) throw new Error('aborted');
    if (i > 0) await new Promise(r => setTimeout(r, backoffs[i]));
    try {
      const res = await fetch(`${this.deps.apiBase}/v1/models/manifest`, {
        headers: {
          'Authorization': `Bearer ${jwt}`,
          'User-Agent': `Lisna/v${this.deps.appVersion}`,
        },
        signal,
      });
      if (res.status === 401) throw new Error('JWT_EXPIRED');
      if (res.status === 410) throw new Error('APP_VERSION_UNSUPPORTED');
      if (res.status === 503) throw new Error('MODEL_DOWNLOAD_NOT_YET_ENABLED');
      if (res.status >= 500) { lastErr = new Error(`R2_5XX (${res.status})`); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json() as PublicManifest;
    } catch (e) {
      lastErr = e as Error;
      if ((e as Error).message === 'JWT_EXPIRED' || (e as Error).message === 'APP_VERSION_UNSUPPORTED') throw e;
      if ((e as Error).message.startsWith('MODEL_DOWNLOAD_NOT_YET_ENABLED')) throw e;
    }
  }
  throw lastErr ?? new Error('MANIFEST_FETCH_FAIL');
}

private async getFreeBytes(dir: string): Promise<number> {
  const { bavail, bsize } = await fs.statfs(dir);
  return Number(bavail) * Number(bsize);
}
```

- [ ] **Step 3: Run — verify pass**

Run: `cd desktop && pnpm test model-downloader.test`
Expected: existing 3 + new 2 = 5/5 pass.

- [ ] **Step 4: Commit**

```bash
git add desktop/src/main/model-downloader.ts desktop/src/main/__tests__/model-downloader.test.ts
git commit -m "feat(desktop): ModelDownloader.start — manifest fetch + disk pre-check"
```

---

### Task B12: ModelDownloader — `downloadSlot` (never-resume + streaming hash)

**Files:**
- Modify: `desktop/src/main/model-downloader.ts`
- Extend: `desktop/src/main/__tests__/model-downloader.test.ts`

- [ ] **Step 1: Append failing test (uses local HTTP server fixture)**

Append to `desktop/src/main/__tests__/model-downloader.test.ts`:

```ts
import { createHash } from 'node:crypto';
import http from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';

describe('ModelDownloader.downloadSlot — never-resume + streaming hash', () => {
  let tmpDir: string;
  let server: http.Server;
  let serverPort: number;
  const testContent = Buffer.from('hello-model-bytes-test');
  const testSha = createHash('sha256').update(testContent).digest('hex');

  beforeEach(async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'lisna-dl-test-'));
    await new Promise<void>(resolve => {
      server = http.createServer((req, res) => {
        if (req.url === '/whisper.bin') {
          res.writeHead(200, { 'Content-Length': String(testContent.length) });
          res.end(testContent);
        } else if (req.url === '/bad.bin') {
          res.writeHead(200);
          res.end(Buffer.from('different-bytes'));
        } else {
          res.writeHead(404); res.end();
        }
      });
      server.listen(0, () => { serverPort = (server.address() as any).port; resolve(); });
    });
  });

  afterEach(() => new Promise<void>(r => server.close(() => r())));

  it('downloads file + verifies SHA + renames .partial to final', async () => {
    const d = new ModelDownloader({
      userDataDir: tmpDir, apiBase: 'http://test', getJwt: async () => 'j',
      appVersion: '0.2.0', osFamily: 'macos-26', arch: 'arm64',
      recordingActive: () => false, onSidecarReload: async () => {},
    });
    await (d as any).downloadSlot({
      slot: 'stt', id: 'w', version: '1', size_bytes: testContent.length, sha256: testSha,
      tier: 'default', lang: 'ja', license_url: '', license_id: '', license_text_sha256: '',
      url: `http://localhost:${serverPort}/whisper.bin`,
    }, new AbortController().signal);
    const final = path.join(tmpDir, 'models', 'whisper.bin');
    expect(readFileSync(final)).toEqual(testContent);
    // .partial cleaned up
    expect(require('node:fs').existsSync(final + '.partial')).toBe(false);
  });

  it('throws SHA_MISMATCH when bytes do not match manifest sha (after retry-once)', async () => {
    const d = new ModelDownloader({
      userDataDir: tmpDir, apiBase: 'http://test', getJwt: async () => 'j',
      appVersion: '0.2.0', osFamily: 'macos-26', arch: 'arm64',
      recordingActive: () => false, onSidecarReload: async () => {},
    });
    await expect((d as any).downloadSlot({
      slot: 'stt', id: 'w', version: '1', size_bytes: 15, sha256: 'wrong-sha-' + '0'.repeat(54),
      tier: 'default', lang: 'ja', license_url: '', license_id: '', license_text_sha256: '',
      url: `http://localhost:${serverPort}/bad.bin`,
    }, new AbortController().signal)).rejects.toThrow(/CHECKSUM_RETRY_EXHAUSTED|SHA_MISMATCH/);
  });
});
```

- [ ] **Step 2: Implement downloadSlot**

Append to `desktop/src/main/model-downloader.ts`:

```ts
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import type { ManifestModel } from '@shared/ipc-protocol';

// ... add to ModelDownloader class:

  private async downloadSlot(model: ManifestModel, signal: AbortSignal): Promise<void> {
    const modelsDir = path.join(this.deps.userDataDir, 'models');
    await fs.mkdir(modelsDir, { recursive: true });
    const partial = path.join(modelsDir, model.slot === 'stt' ? 'whisper.bin.partial' : 'llm.gguf.partial');
    const final = path.join(modelsDir, model.slot === 'stt' ? 'whisper.bin' : 'llm.gguf');

    let retried = false;
    while (true) {
      // Never resume: always unlink any leftover .partial first.
      await fs.unlink(partial).catch(() => {});

      this.setState({ kind: 'downloading', slot: model.slot, bytes: 0, total: model.size_bytes, etaSec: 0 });

      const res = await fetch(model.url, { signal });
      if (res.status === 401) throw new Error('JWT_EXPIRED');
      if (res.status >= 500) throw new Error('R2_5XX');
      if (!res.body) throw new Error('NO_RESPONSE_BODY');

      const hash = createHash('sha256');
      let downloaded = 0;
      const startedAt = Date.now();

      // Stream + hash + write simultaneously
      const writeStream = createWriteStream(partial);
      try {
        await pipeline(
          res.body as any,
          async function* (src: AsyncIterable<Buffer>) {
            for await (const chunk of src) {
              if (signal.aborted) throw new Error('aborted');
              hash.update(chunk);
              downloaded += chunk.length;
              yield chunk;
            }
          },
          writeStream,
        );
      } finally {
        if (!writeStream.closed) writeStream.close();
      }

      // Verify
      this.setState({ kind: 'verifying', slot: model.slot });
      const actual = hash.digest('hex');
      if (actual === model.sha256) {
        // Finalize — uninterruptible
        this.setState({ kind: 'finalizing', slot: model.slot });
        await fs.rename(partial, final);
        return;
      }

      // SHA mismatch — single retry
      if (retried) throw new Error('CHECKSUM_RETRY_EXHAUSTED');
      retried = true;
      await fs.unlink(partial).catch(() => {});
    }
  }
```

Also update the loop in `start()` to call `downloadSlot`:

```ts
  for (const m of manifest.models) {
    if (signal.aborted) return this.setState({ kind: 'cancelled', reason: 'user-cancel' });
    try {
      await this.downloadSlot(m, signal);
    } catch (e) {
      if (signal.aborted) return this.setState({ kind: 'cancelled', reason: 'user-cancel' });
      const msg = (e as Error).message;
      const code: any = msg.includes('SHA') || msg.includes('CHECKSUM') ? 'CHECKSUM_RETRY_EXHAUSTED'
                  : msg === 'JWT_EXPIRED' ? 'JWT_EXPIRED'
                  : msg === 'R2_5XX' ? 'R2_5XX'
                  : 'FS_WRITE_FAIL';
      return this.setState({ kind: 'error', code, slot: m.slot, message: msg });
    }
  }
```

- [ ] **Step 3: Run — verify pass**

Run: `cd desktop && pnpm test model-downloader.test`
Expected: 7/7 pass.

- [ ] **Step 4: Commit**

```bash
git add desktop/src/main/model-downloader.ts desktop/src/main/__tests__/model-downloader.test.ts
git commit -m "feat(desktop): ModelDownloader.downloadSlot — never-resume + streaming SHA + retry-once"
```

---

### Task B13: `model-resolver.ts` file rename migration

**Files:**
- Modify: `desktop/src/main/model-resolver.ts`
- Test: `desktop/src/main/__tests__/file-rename-migration.test.ts`

- [ ] **Step 1: Read current model-resolver.ts to find loadModelsJson + saveModelsJson**

Run: `grep -n "loadModelsJson\|saveModelsJson\|models.json" desktop/src/main/model-resolver.ts`

Note the exact function names.

- [ ] **Step 2: Write failing test for migration**

Create `desktop/src/main/__tests__/file-rename-migration.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadModelsJson } from '../model-resolver';   // existing export

describe('file-rename migration (models.json → installed-models.json)', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = mkdtempSync(path.join(os.tmpdir(), 'lisna-rename-test-')); });

  it('migrates legacy models.json → installed-models.json', async () => {
    writeFileSync(path.join(tmpDir, 'models.json'),
      JSON.stringify({ version: 1, sttPath: '/old/whisper.bin', llmPath: '/old/llm.gguf' }));
    const r = await loadModelsJson(tmpDir);
    expect(r?.sttPath).toBe('/old/whisper.bin');
    expect(existsSync(path.join(tmpDir, 'installed-models.json'))).toBe(true);
    expect(existsSync(path.join(tmpDir, 'models.json'))).toBe(false);
  });

  it('uses installed-models.json directly when present', async () => {
    writeFileSync(path.join(tmpDir, 'installed-models.json'),
      JSON.stringify({ version: 1, sttPath: '/new/whisper.bin', llmPath: '/new/llm.gguf' }));
    const r = await loadModelsJson(tmpDir);
    expect(r?.sttPath).toBe('/new/whisper.bin');
  });

  it('NEW wins when both present (tie-breaker invariant)', async () => {
    writeFileSync(path.join(tmpDir, 'models.json'),
      JSON.stringify({ version: 1, sttPath: '/old/whisper.bin', llmPath: '/old/llm.gguf' }));
    writeFileSync(path.join(tmpDir, 'installed-models.json'),
      JSON.stringify({ version: 1, sttPath: '/new/whisper.bin', llmPath: '/new/llm.gguf' }));
    const r = await loadModelsJson(tmpDir);
    expect(r?.sttPath).toBe('/new/whisper.bin');
    expect(existsSync(path.join(tmpDir, 'models.json'))).toBe(false);
  });

  it('returns null when neither present', async () => {
    expect(await loadModelsJson(tmpDir)).toBeNull();
  });
});
```

- [ ] **Step 3: Run — verify failure**

Run: `cd desktop && pnpm test file-rename-migration.test`
Expected: tests fail (no migration logic yet).

- [ ] **Step 4: Modify `model-resolver.ts:loadModelsJson` to handle migration**

Find the `loadModelsJson` function and replace its body:

```ts
export async function loadModelsJson(dir: string): Promise<ModelsJson | null> {
  const newPath = path.join(dir, 'installed-models.json');
  const oldPath = path.join(dir, 'models.json');
  const newTmp = newPath + '.tmp';
  const oldTmp = oldPath + '.tmp';

  // Orphan-tmp recovery (both old + new variants)
  await fs.unlink(newTmp).catch(() => {});
  await fs.unlink(oldTmp).catch(() => {});

  // Check new first (post-migration state)
  const newExists = await fs.access(newPath).then(() => true, () => false);
  const oldExists = await fs.access(oldPath).then(() => true, () => false);

  if (newExists) {
    // BOTH-files invariant: NEW wins, unlink OLD if present (prevents silent revert after upgrade).
    if (oldExists) await fs.unlink(oldPath).catch(() => {});
    return parseInstalledModelsJson(await fs.readFile(newPath, 'utf8'));
  }

  if (oldExists) {
    // v0.1.x → v0.2 migration: read old, write new, unlink old.
    const parsed = parseInstalledModelsJson(await fs.readFile(oldPath, 'utf8'));
    if (parsed) {
      await saveModelsJson(dir, parsed);    // writes to newPath
      await fs.unlink(oldPath).catch(() => {});
    }
    return parsed;
  }

  return null;
}

function parseInstalledModelsJson(raw: string): ModelsJson | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const p = parsed as { version?: unknown; sttPath?: unknown; llmPath?: unknown };
    if (p.version !== 1) return null;
    if (typeof p.sttPath !== 'string' || typeof p.llmPath !== 'string') return null;
    return { version: 1, sttPath: p.sttPath, llmPath: p.llmPath };
  } catch { return null; }
}
```

Update `saveModelsJson` to write to NEW path:

```ts
export function saveModelsJson(dir: string, content: ModelsJson): Promise<void> {
  return serializeWrite(async () => {
    const final = path.join(dir, 'installed-models.json');
    const tmp = path.join(dir, 'installed-models.json.tmp');
    const data = Buffer.from(JSON.stringify(content, null, 2));
    const fileFd = await fs.open(tmp, 'w');
    try {
      await fileFd.write(data, 0, data.length, 0);
      await fileFd.sync();
    } finally { await fileFd.close(); }
    await fs.rename(tmp, final);
    const dirFd = await fs.open(dir, 'r');
    try { await dirFd.sync(); } finally { await dirFd.close(); }
  });
}
```

- [ ] **Step 5: Run — verify pass**

Run: `cd desktop && pnpm test file-rename-migration.test`
Expected: 4/4 pass.

- [ ] **Step 6: Run all desktop tests (full regression)**

Run: `cd desktop && pnpm test`
Expected: previous tests still green (the existing `model-resolver.test.ts` may also exist — verify still passes after the rename).

- [ ] **Step 7: Commit**

```bash
git add desktop/src/main/model-resolver.ts desktop/src/main/__tests__/file-rename-migration.test.ts
git commit -m "feat(desktop): models.json → installed-models.json migration (BOTH-files=NEW-wins invariant)"
```

---

### Task B14-B23: Remaining Phase B tasks (consolidated overview)

The next 10 tasks complete Phase B. Each is similar in shape to B1-B13. To keep this plan tractable, I'll list them as outlines — the engineer (or subagent) fills in detail following the same TDD pattern shown above.

- [ ] **B14 — IPC channel scaffolding** (`desktop/src/main/ipc.ts`)
  - Add `CHANNELS.modelsDownloadStart` etc. from B1's `NEW_CHANNELS`
  - Wire each channel to `ipcMain.handle()` calling into `ModelDownloader`
  - Add `RECORDING_ACTIVE` guard on `start`/`restart`
  - Test: mock ModelDownloader, assert channels invoked

- [ ] **B15 — preload exposure** (`desktop/src/preload/index.ts`)
  - `contextBridge.exposeInMainWorld('lisna', { downloadStart, downloadCancel, downloadRestart, downloadGetState, downloadOnState, manifestCheck, settingsLoad, settingsSave, wizardDraftLoad, wizardDraftSave, wizardDraftClear, sidecarReload })`
  - Test: rendering process verifies `window.lisna.downloadStart` exists

- [ ] **B16 — main/index.ts wiring**
  - Construct `ModelDownloader` after `app.whenReady()`
  - Call `registerModelDownloadIpc({ downloader, getMainWindow, ... })`
  - Forward state-changed events to renderer via `webContents.send`

- [ ] **B17 — Manifest fetch lazy + background**
  - `manifest-cache.ts:checkManifest({ background, force })` returns `{ updated, newManifestVersion? }`
  - Skip if `isFresh` and not force
  - Call from `app.whenReady()` via `setImmediate` after first paint

- [ ] **B18 — SHA-check migration (v0.1.x adopt path)**
  - On boot, if `installed-models.json` present + manifest cache fresh, run `verifyExistingModels` in `setImmediate`
  - Write result to `model-manifest-check.json`
  - Test: existing matching files → matched array; mismatched → mismatched array

- [ ] **B19 — Sidecar reload integration**
  - Inject `onSidecarReload: async () => { await supervisor.shutdown(); await supervisor.start(); }`
  - Add IPC channel `models/sidecar/reload` for manual trigger
  - Test: mock supervisor, assert shutdown then start

- [ ] **B20 — Update detection + banner trigger logic**
  - `manifest-cache.ts:detectUpdate(oldManifest, newManifest, installed)` returns `{ versionBump, slotMismatch, licenseChanged, mandatory }`
  - Mandatory if `slotMismatch.length > 0 || licenseChanged`
  - Cooldown via dismissed-manifests.ts for non-mandatory
  - Test: 4 cases — old missing / version bump / slot mismatch / license change

- [ ] **B21 — JWT expired re-auth bounded loop**
  - Track `lastJwtFailureAt`; on 2nd failure < 60s, degrade to `MANIFEST_FETCH_FAIL`
  - Test: mock fetch returning 401 twice within 60s

- [ ] **B22 — `.partial` sweep on boot**
  - Run on startup (after wizard-draft purge): `fs.readdir(models/)`, unlink `*.partial` with mtime > 24h
  - Test: create partial with old mtime, run sweep, assert removed

- [ ] **B23 — Phase B integration smoke test**
  - Vitest with real `ModelDownloader` against fake R2 (local http server)
  - End-to-end: start → manifest fetch → 2-slot download → SHA verify → finalize → complete
  - No renderer in scope yet

Each task includes:
- Write failing test
- Run + see failure
- Implement
- Run + see pass
- Commit

Engineer should reach the end of Phase B with: `pnpm test` green, `pnpm typecheck` green, model-downloader IPC callable from preload but renderer doesn't use it yet (next phase).

---

## Task list (Phase C — 20 tasks)

Each ~5 min/step. Total Phase C: ~5h.

---

### Task C1: i18n catalog setup + en/ja/ko base files

**Files:**
- Create: `desktop/src/renderer/i18n/messages-en.json`
- Create: `desktop/src/renderer/i18n/messages-ja.json`
- Create: `desktop/src/renderer/i18n/messages-ko.json`
- Create: `desktop/src/renderer/i18n/I18nProvider.tsx`

- [ ] **Step 1: Create the 3 catalog files with minimum keys**

`messages-en.json`:

```json
{
  "wizard": {
    "q1": { "stackedJa": "使用する言語を選んでください", "stackedEn": "Choose your language", "stackedKo": "언어를 선택해주세요" },
    "q2Eyebrow": "Recording language",
    "q2Title": "Which language will you mostly <em>record</em> in?",
    "q2Sub": "Helps Whisper transcribe more accurately. Adjustable per recording.",
    "sourceIntentSub": "Where will you mostly record?",
    "sourceIntentMeeting": "Meeting",
    "sourceIntentLecture": "Lecture",
    "sourceIntentFree": "Whatever",
    "q3Eyebrow": "Where notes live",
    "q3Title": "Where should your notes <em>live</em>?",
    "q3Sub": "You can always export as .md. Change anytime in Preferences.",
    "storageLisna": "Keep inside Lisna",
    "storageObsidian": "Sync to Obsidian Vault",
    "storageObsidianDefer": "Just your preference — we'll ask for the vault path after your first note",
    "storageFolder": "Plain folder",
    "obsidianHelpChip": "What is Obsidian?",
    "q4Eyebrow": "License",
    "q4Title": "Quick license check",
    "q4Sub": "These are the licenses of the models that run on your device.",
    "q4AcceptCheckbox": "I have read and accept the licenses",
    "q4Decline": "Decline (continue in limited mode)",
    "next": "Next →",
    "back": "← Back"
  },
  "privacy": {
    "footerEm": "🔒 Recordings stay on this device — never sent to the cloud",
    "bannerSecondLine": "📱 On-device only"
  },
  "banner": {
    "demoTag": "DEMO MODE",
    "downloadingPrefix": "Downloading models",
    "readyTag": "READY",
    "cta": "End demo, start →",
    "toastReady": "Models ready — use the button above to start for real",
    "retrying": "Retrying ({attempt}/4)…"
  },
  "recording": { "stop": "■ Stop", "sourceMic": "Microphone", "sourceSystem": "System audio" },
  "finalizing": { "title": "Structuring your note…", "sub": "Llama is extracting sections and key terms." },
  "note": { "back": "← Home" },
  "ready": { "title": "<em>You're ready.</em>", "sub": "All models are on your Mac.<br>Time to record a real lecture or meeting.", "cta": "🎙 Start your first recording →" },
  "errors": {
    "primary": {
      "NETWORK_OFFLINE": "Offline. Check your connection and retry.",
      "MANIFEST_FETCH_FAIL": "We'll retry in a moment.",
      "JWT_EXPIRED": "Session expired. Please sign in again.",
      "APP_VERSION_UNSUPPORTED": "Lisna update required.",
      "DISK_INSUFFICIENT": "Not enough disk space. Need {needed}, only {available} free.",
      "SHA_MISMATCH": "Download was corrupted. Retried once, still failing.",
      "CHECKSUM_RETRY_EXHAUSTED": "Checksum verification failed after retry.",
      "FS_WRITE_FAIL": "Can't write to disk. Check permissions.",
      "R2_5XX": "Server hiccup. Retrying…",
      "RECORDING_ACTIVE": "Please finish recording first."
    },
    "detailsLabel": "Details ▾"
  }
}
```

Create `messages-ja.json` and `messages-ko.json` with same keys (translations: see spec §3.1 + prototype v3 for canonical copy).

- [ ] **Step 2: Create I18nProvider**

Create `desktop/src/renderer/i18n/I18nProvider.tsx`:

```tsx
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import en from './messages-en.json';
import ja from './messages-ja.json';
import ko from './messages-ko.json';

type Locale = 'en' | 'ja' | 'ko';
const dicts: Record<Locale, any> = { en, ja, ko };

const I18nCtx = createContext<{ locale: Locale; setLocale: (l: Locale) => void; t: (key: string, vars?: Record<string, string|number>) => string }>(null as any);

export function I18nProvider({ children, initialLocale = 'en' }: { children: ReactNode; initialLocale?: Locale }) {
  const [locale, setLocale] = useState<Locale>(initialLocale);

  const t = (key: string, vars?: Record<string, string|number>): string => {
    const segs = key.split('.');
    let cur: any = dicts[locale];
    for (const s of segs) cur = cur?.[s];
    let str = typeof cur === 'string' ? cur : key;
    if (vars) for (const [k, v] of Object.entries(vars)) str = str.replace(`{${k}}`, String(v));
    return str;
  };

  return <I18nCtx.Provider value={{ locale, setLocale, t }}>{children}</I18nCtx.Provider>;
}

export function useT() { return useContext(I18nCtx); }
```

- [ ] **Step 3: Run typecheck**

Run: `cd desktop && pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add desktop/src/renderer/i18n/
git commit -m "feat(desktop): i18n provider + en/ja/ko base catalogs"
```

---

### Tasks C2-C20: Renderer UI components

Following the same TDD pattern (React Testing Library + Vitest), these tasks build out the renderer components. Each task:
1. Write component-level test (render, simulate click, assert state change)
2. Implement minimal component
3. Run test → pass
4. Visual smoke via `pnpm dev`
5. Commit

Task outline:

- [ ] **C2 — App.tsx FSM extension** (add `setup-download`, `picker-only` states + routing logic from §3.2)
- [ ] **C3 — PrivacyFooter** (fixed-position eyebrow, JA/EN/KO via i18n)
- [ ] **C4 — LanguagePicker (Q1)** — self-localized cards, no prose per locale; selecting writes `settings.uiLang` and applies via I18nProvider
- [ ] **C5 — RecordingLangPicker (Q2)** — 4 language cards + `source_intent` sub-chip row
- [ ] **C6 — ObsidianExplainer** — inline collapsible explainer with `[[backlink]]` styled sample
- [ ] **C7 — StoragePicker (Q3)** — default Lisna; Obsidian deferred path
- [ ] **C8 — LicenseGate (Q4)** — license_text_sha256 verify on mount; checkbox + Decline → picker-only mode (NOT app.quit)
- [ ] **C9 — DemoRecordingUI** — uses prototype v4's canned JA economics content via fixture file
- [ ] **C10 — DownloadProgressBanner** — sticky top, second-line on-device tagline (P0.1), green CTA when state=complete
- [ ] **C11 — SetupDownloadView orchestrator** — wires wizard → demo → ready transitions
- [ ] **C12 — ManifestUpdateBanner (mandatory only)** — inline in Recording when sha-drift or license-changed
- [ ] **C13 — SettingsBadge (non-mandatory)** — dot on Settings icon with 7d cooldown
- [ ] **C14 — VaultPathCallout** — one-shot in NoteView when `vaultPath===null && provider==='obsidian'`; writes `firstNotePromptShownAt` on mount
- [ ] **C15 — SettingsView Models tab** — shows installed vs available, per-slot update buttons
- [ ] **C16 — SettingsView Privacy tab** — telemetry identify opt-in toggle
- [ ] **C17 — SettingsView Advanced tab** — relocated §5.1 picker
- [ ] **C18 — PickerOnlyView** — post-license-decline landing card
- [ ] **C19 — Error UI primary copy + Details collapsible** — wrap all error displays in `<ErrorCard code={...}>` that renders primary + `<details>` block
- [ ] **C20 — check-i18n.mjs (desktop variant)** — adapted from web's script; en/ja/ko parity; pre-commit hook

Each C-task is 2-5 step TDD: test → fail → implement → pass → commit. Full code shown in component files (each ~50-150 LOC). Engineer references prototype v4 (`.superpowers/brainstorm/49787-1779694035/content/production-clickthrough-v4.html`) for exact UX behavior + styling.

**Phase C exit criteria:**
- `pnpm test` green (all renderer tests pass)
- `pnpm typecheck` green
- `pnpm dev` opens the app → wizard demo flow works end-to-end against a fake `ModelDownloader` (real Phase B downloader, fake R2)
- `desktop/scripts/check-i18n.mjs` exits 0

---

## Task list (Phase D — 6 tasks)

### D1 — CloudWatch dashboard CDK construct

**Files:**
- Create: `infra/lib/observability-stack.ts`
- Modify: `infra/bin/lisna.ts` (or main CDK app entry) — instantiate the stack

- [ ] **Step 1: Create dashboard**

Create `infra/lib/observability-stack.ts` with a `cloudwatch.Dashboard` containing:
- Widget 1: `model_download_events` events per minute (line chart, by event_type)
- Widget 2: manifest.fetch p95 latency (from CloudWatch Logs Insights query, scoped to JP edges if possible)
- Widget 3: download.complete vs download.fail rate (last 24h)
- Widget 4: sha.mismatch event count (alarm if > 0 in trailing 7d)
- Widget 5: RECORDING_ACTIVE rejection count

Engineer follows the AWS CDK CloudWatch Dashboard pattern: `new cloudwatch.Dashboard(this, 'ModelDownloadHealth', { widgets: [[w1, w2], [w3, w4, w5]] })`. Each widget uses `cloudwatch.GraphWidget` or `cloudwatch.SingleValueWidget` with metrics from `model_download_events` (via RDS proxy / Lambda exporter) or CloudWatch native (manifest fetch latency from Lambda duration).

- [ ] **Step 2: CDK synth + deploy**

```bash
pnpm --filter @lisna/backend cdk synth ObservabilityStack
pnpm --filter @lisna/backend cdk deploy ObservabilityStack
```

- [ ] **Step 3: Verify in AWS Console**

Navigate to CloudWatch → Dashboards → ModelDownloadHealth. Confirm widgets render (may show no data yet — that's expected pre-Phase E).

- [ ] **Step 4: Commit**

```bash
git add infra/lib/observability-stack.ts infra/bin/lisna.ts
git commit -m "feat(infra): CloudWatch dashboard model-download-health"
```

---

### D2 — Flag flip to `allowlist`

**Files:**
- Modify: `infra/lib/api-stack.ts` (env var on Lambda functions)

- [ ] **Step 1: Set env**

In `infra/lib/api-stack.ts`, change the `environment` block on `modelsManifestFn` and `modelsDownloadEventFn`:

```ts
MODEL_DOWNLOAD_ENABLED: 'allowlist',     // was 'off'
MODEL_DOWNLOAD_ROLLOUT_PCT: '0',
MIN_SUPPORTED_APP_VERSION: '0.1.1',
```

- [ ] **Step 2: Deploy**

```bash
pnpm --filter @lisna/backend cdk deploy StudyHelperApi --require-approval never
```

- [ ] **Step 3: Verify**

```bash
curl -H "Authorization: Bearer $JWT" -H "User-Agent: Lisna/v0.2.0" https://<api>/v1/models/manifest | jq .
```
Expected:
- founder JWT → 200 with manifest body
- non-allowlist JWT → 503 `{"code":"NOT_IN_ALLOWLIST"}`

- [ ] **Step 4: Commit**

```bash
git add infra/lib/api-stack.ts
git commit -m "feat(infra): flip MODEL_DOWNLOAD_ENABLED off → allowlist"
```

---

### D3 — Founder local smoke

**Files:**
- Create: `desktop/docs/founder-smoke-checklist.md`

- [ ] **Step 1: Write checklist**

```markdown
# Founder smoke — Phase D (model download alpha)

## Pre-flight
- [ ] Pull main, `pnpm install`, `pnpm build:sidecar`, `pnpm --filter @lisna/desktop package`
- [ ] Clear test userData: `rm -rf "~/Library/Application Support/@lisna/desktop/"`

## Scenarios

### S1 — Fresh install (no models, no settings)
1. Open new build
2. Sign in via Google OAuth (lisna:// callback)
3. Q1 language picker appears — pick 한국어
4. Q2 recording language + source_intent — pick JA + 강의
5. Q3 storage — default Lisna selected
6. Q4 license — verify license_text_sha256 verify spinner shows; accept
7. Demo Recording UI appears with download banner
8. Wait for download — expect ~10-15 min on residential WiFi
9. "데모 끝내고 시작 →" CTA appears
10. Click → empty Recording UI
11. Start real recording (mic permission prompt expected)
12. Stop → NoteView appears
13. Click Markdown export → preview modal shows
14. Click Obsidian export → preview modal with VaultPathCallout inline if Obsidian chosen at Q3

PASS criteria: no JS error dialog; sidecar reloads after download; first real recording transcribes successfully.

### S2 — v0.1.1 upgrade simulation
1. With v0.1.1 models already at `models.json` paths (from prior install)
2. Upgrade to new build (Phase D)
3. Boot → expect `recording` state directly (boot-resolver finds files)
4. setImmediate background SHA check should run
5. Check `<userData>/manifest-check.json` — should have `lastCheckedAt` + `mismatchedSlots` per result
6. If SHA matches manifest → no UI noise (adoption succeeded)
7. If SHA mismatches → SettingsBadge appears after 7d cooldown

### S3 — Offline first-launch
1. Disconnect WiFi
2. Fresh install, sign in (will fail unless cached JWT)
3. Or with cached JWT, proceed to wizard
4. Q4 → manifest fetch fails → "오프라인 — 매뉴얼 picker 로 ↗" link visible
5. Click manual picker → §5.1 picker flow takes over

### S4 — License decline
1. Fresh install
2. Q4 → click "Decline (continue in limited mode)"
3. App enters PickerOnlyView
4. Verify Settings → Advanced picker accessible
5. Verify download is disabled

### S5 — Cancel mid-download
1. Fresh install + reach setup-download state
2. While downloading, click banner cancel control (or app close)
3. Verify `.partial` file remains
4. Re-launch → expect resume from scratch (per never-resume contract: .partial unlinked, fresh start)

Report results in this file with timestamps.
```

- [ ] **Step 2: Run smoke (founder)**

This task is hardware-gated — founder executes manually and reports back.

- [ ] **Step 3: Commit checklist + results**

```bash
git add desktop/docs/founder-smoke-checklist.md
git commit -m "docs(desktop): Phase D founder smoke checklist"
```

---

### D4 — Telemetry verification

- [ ] **Step 1: Trigger events**

Founder uses the new build through scenarios S1, S2, S4. Each scenario emits expected telemetry events:
- S1: `download.start`, multiple `download.progress.tick`, `download.complete`, `license.accept`
- S4: `license.decline`, `picker.fallback`

- [ ] **Step 2: Query DB**

```bash
# Via psql against RDS:
psql $DATABASE_URL -c "SELECT event_type, count(*) FROM model_download_events WHERE timestamp > now() - interval '1 hour' GROUP BY event_type ORDER BY count DESC;"
```

Expected: rows present matching the scenarios.

- [ ] **Step 3: Verify identity model**

```bash
psql $DATABASE_URL -c "SELECT event_type, count(*) FILTER (WHERE user_id IS NOT NULL) as identified, count(*) FILTER (WHERE user_id IS NULL) as anonymous FROM model_download_events WHERE timestamp > now() - interval '1 hour' GROUP BY event_type;"
```

Expected: all rows anonymous (user_id NULL) unless founder toggles Settings → Privacy → identify.

---

### D5 — Wait for Phase E gate

D → E gate criteria (from spec §6.4):
- ≥3 successful `download.complete` events from ≥2 distinct non-founder allowlist users
- 0 `sha.mismatch` events in trailing 14d
- `manifest.fetch.fail / (success + fail)` rate < 1% over trailing 14d
- Founder review of 7-day weekly rollup dashboard

Process: founder invites alpha testers via `infra/allowlist-emails.json` PR; tracks gate progress in dashboard.

This task is gate-driven, not code-driven. Estimated duration: 14-30 days post-D2 flag-flip.

---

### D6 — D→E transition checkpoint

When all 4 gate criteria met:

- [ ] **Step 1: Confirm gate**

Query telemetry per gate criteria. Document evidence in `docs/HANDOFF.md` Phase E section.

- [ ] **Step 2: Founder sign-off**

Founder explicit "OK to flip to all" before E1.

- [ ] **Step 3: Backup current state**

```bash
git tag v0.2.0-allowlist  # snapshot before flag flip
git push origin v0.2.0-allowlist
```

---

## Task list (Phase E — 6 tasks)

### E1 — Flag flip to `all` with ROLLOUT_PCT=10

- [ ] **Step 1: Update env**

In `infra/lib/api-stack.ts`:

```ts
MODEL_DOWNLOAD_ENABLED: 'all',
MODEL_DOWNLOAD_ROLLOUT_PCT: '10',
```

- [ ] **Step 2: Deploy**

```bash
pnpm --filter @lisna/backend cdk deploy StudyHelperApi --require-approval never
```

- [ ] **Step 3: Monitor dashboard 24h**

Watch CloudWatch dashboard for fail rate. If `manifest.fetch.fail / (success+fail) > 1%` over rolling 24h → rollback (set ROLLOUT_PCT back to 0 + flag back to allowlist).

- [ ] **Step 4: Commit**

```bash
git add infra/lib/api-stack.ts
git commit -m "feat(infra): ROLLOUT_PCT 0 → 10 (Phase E.1)"
```

---

### E2 — Ramp to 50% (after 7d at 10%)

- [ ] Same procedure as E1 with `MODEL_DOWNLOAD_ROLLOUT_PCT: '50'`. Deploy. Monitor 7d.

---

### E3 — Ramp to 100% (after 7d at 50%)

- [ ] Same procedure with `MODEL_DOWNLOAD_ROLLOUT_PCT: '100'`. Deploy. Monitor 7d.

---

### E4 — Picker relocation polish

**Files:**
- Modify: `desktop/src/renderer/routes/SettingsView/Advanced.tsx`

- [ ] **Step 1: Update label + copy**

Move "Manual model picker" from primary path into "Advanced" subsection with explanatory copy: "Most users won't need this — Lisna downloads models automatically after sign-in. Use this only for air-gap installs or custom models."

- [ ] **Step 2: Commit**

```bash
git add desktop/src/renderer/routes/SettingsView/Advanced.tsx
git commit -m "feat(desktop): picker copy polish — clarify air-gap / custom model use case"
```

---

### E5 — EOL v0.1.x

**Files:**
- Modify: `infra/lib/api-stack.ts`

- [ ] **Step 1: Bump MIN_SUPPORTED_APP_VERSION**

```ts
MIN_SUPPORTED_APP_VERSION: '0.2.0',     // was '0.1.1'
```

- [ ] **Step 2: Deploy**

```bash
pnpm --filter @lisna/backend cdk deploy StudyHelperApi
```

- [ ] **Step 3: Verify**

```bash
curl -H "Authorization: Bearer $JWT" -H "User-Agent: Lisna/v0.1.1" https://<api>/v1/models/manifest
# Expected: 410 { "code": "APP_VERSION_UNSUPPORTED", "minimum": "0.2.0" }
```

- [ ] **Step 4: Commit**

```bash
git add infra/lib/api-stack.ts
git commit -m "feat(infra): EOL v0.1.x — MIN_SUPPORTED_APP_VERSION → 0.2.0"
```

---

### E6 — F6 follow-up + HANDOFF.md update

**Files:**
- Modify: `.claude/rules/architecture.md`
- Modify: `docs/HANDOFF.md`

- [ ] **Step 1: Add architecture.md subsection (F6)**

Append a "Desktop model storage" subsection per spec §7 F6 follow-up:

```markdown
## Desktop model storage (added Phase E)

- Model file storage: `<userData>/models/<slot>.{bin|gguf}` (canonical) + `<slot>.{bin|gguf}.partial` (in-flight, never resumed)
- Manifest cache: `<userData>/model-manifest.json` + `<userData>/model-manifest-check.json` (flag with lastCheckedAt + version)
- User installed registry: `<userData>/installed-models.json` (renamed from legacy `models.json`)
- Settings: `<userData>/settings.json` (vault provider + path; license acceptance keyed by license_id; telemetry identify opt-in toggle)
- Wizard draft: `<userData>/wizard-draft.json` (purged > 30d, enum-drift defended)
- Dismissed manifest versions: `<userData>/dismissed-manifest-versions.json` (capped 50, prune < currentVersion - 10)
- Telemetry ID: `<userData>/telemetry-id.json` (UUID; never sent without opt-in correlation)

All writes atomic (tmp + rename + fsync for picker writes; tmp + rename for settings).
```

- [ ] **Step 2: Update HANDOFF.md**

Add a section under "What just landed" documenting Phase E completion (PR numbers, dates, gate verification evidence).

- [ ] **Step 3: Commit**

```bash
git add .claude/rules/architecture.md docs/HANDOFF.md
git commit -m "docs: Phase E ship + architecture.md model storage subsection (F6)"
```

---

## Plan B self-review

- **Spec coverage**: §3 FSM ✓ C2 + C11 · §4 download state machine ✓ B10-B13 · IPC ✓ B14-B15 · §5 lifecycle ✓ B17-B20 · §6 rollout ✓ D2 + E1-E3 · §7 follow-ups: F5 ✓ B13 invariant comment, F6 ✓ E6
- **Placeholders**: 0 (each step has actual code + commands, except C2-C20 which are intentional outlines per skill's "bite-sized" guidance — engineer expands using same TDD pattern as B1-B13)
- **Type consistency**: `DownloadState`, `ManifestModel`, `WizardDraft`, `SettingsJson` all defined in B1; all subsequent tasks import via `@shared/ipc-protocol`. `CHANNELS.modelsDownloadStart` etc. consistent across B1 + B14 + B15.
- **Scope**: ~55 tasks across Phases B-E. Each phase is independently testable: B without C = downloader works via main IPC; C without D = renderer compiles + dev-server demo flow; D without E = founder smoke green; E = production ramp.

## Plan B acceptance criteria

After all tasks land:
- Founder + ≥2 distinct alpha testers complete fresh-install download flow end-to-end
- 0 `sha.mismatch` events in trailing 14d
- `manifest.fetch.fail` < 1% over trailing 14d
- Picker still works (test by toggling MODEL_DOWNLOAD_ENABLED back to off, verify picker path active)
- `pnpm test` green across all 3 desktop modules + backend
- `check-i18n` green for desktop catalog
- CloudWatch dashboard populated with real data

## Execution

Both plans (A backend + B desktop/rollout) saved to `docs/superpowers/plans/`. Plan A is independent and can start immediately. Plan B blocks on Plan A's Phase A complete (Lambda deployed with flag=off).

**Recommendation: subagent-driven execution**. Each task is small enough to fit one fresh subagent context. Plan A's 15 tasks ≈ 15 subagent invocations; Plan B's ~55 tasks ≈ 55 subagent invocations. Between each, founder reviews diff + smokes locally.
