# Lisna Desktop v2 — On-Device Model Download Architecture

**Status:** Draft for founder review · 2026-05-25
**Author:** Claude (via brainstorming session)
**Approved by:** 5 independent reviewer loops (§1 architecture, §2 FSM/UX, §3 state-machine + IPC + filesystem, §4 updates/lifecycle, §5 rollout/telemetry/phasing)
**Supersedes:** none (extends §5.1 first-run picker spec)
**Implementation entry:** `superpowers:writing-plans` after this doc is approved

---

## 1 — Context

The current Lisna desktop alpha (v0.1.1, live since 2026-05-22) onboards new users via a **manual picker**: the first-run flow asks the user to navigate Finder, locate the Whisper and Llama model files (downloaded out-of-band — typically a Discord link to a GitHub release tagged `models-latest`), and select each one. Once picked, paths are written to `<userData>/models.json` and the sidecar uses them.

This works for the founder and the first handful of alpha invites, but does not scale:

- **Out-of-band downloads are friction.** The download page already hints at this dead-end (`web/src/app/[locale]/download/page.tsx` references a `models-latest` tag that doesn't yet exist — flagged in the v0.1.1 release audit).
- **Updates have no mechanism.** New Whisper / Llama versions or hot-fixes can't reach users without re-distributing the entire DMG.
- **The picker is the only path.** Air-gap / advanced users have no way to swap models in place.

This spec defines the architecture that replaces the default picker with an **app-managed, login-gated, R2-hosted model download** while preserving the picker as an advanced fallback.

### 1.1 References

- Concept yardstick: `docs/PRD.md` (every spoken sound, on the user's own device, turned into structured text). v2 stack-stage trigger explicitly names "download UX" as one of three criteria.
- v0.1.0 alpha launch: memory `phase_o_alpha_launched_2026-05-22`
- v0.1.1 ship: memory `v2_alpha_merged_2026-05-18`, PR #38 + #40 (boot-crash fix + size string sync)
- Existing picker: `desktop/src/main/model-resolver.ts` (§5.1 implementation)
- Existing auth (already shipped): `desktop/src/main/url-scheme.ts` (lisna:// scheme) + `desktop/src/main/auth/{exchange,keychain}.ts`
- Existing AbortController pattern: `desktop/src/main/auth/exchange.ts:41-48`
- Existing atomic write pattern: `desktop/src/main/model-resolver.ts:saveModelsJson`
- Existing FSM: `desktop/src/renderer/App.tsx` (post-auth shell with view discriminated union)
- Project i18n rule: `.claude/rules/i18n.md`
- Architecture rule (will be amended in implementation plan): `.claude/rules/architecture.md`
- Prototype that drove this design: `.superpowers/brainstorm/49787-1779694035/content/production-clickthrough-v4.html`

### 1.2 Scope

**In scope:**
- v2 architecture covering alpha + GA + future Llama 7B / kotoba-whisper swap
- Cloudflare R2 hosting (egress-free, S3-compatible)
- Login-gated auto-download (Lisna JWT)
- Settings wizard pre-download (language, recording-language, storage destination, license acceptance)
- Demo Recording UI during download (real UI shell, pre-canned Japanese content)
- §5.1 picker retained as advanced fallback
- Manifest-driven model updates with per-version dismissal
- Telemetry (manifest fetch / download success / cancel / sha mismatch / etc.)

**Out of scope:**
- A/B testing of models per user cohort (manifest doesn't carry cohort metadata)
- Multi-region pinning (R2's automatic edge routing assumed)
- Cohort-based feature rollouts (only binary `allowlist` → `all` here)
- Migrating v1 (Chrome extension) to a different model pipeline — v1 stays on cloud STT/curator per `CLAUDE.md` scope freeze

### 1.3 Locked decisions (do not re-litigate)

| # | Decision | Source |
|---|---|---|
| 1 | Hosting: Cloudflare R2 | Founder Q: 호스팅 source |
| 2 | Auth: login-gated, not anonymous, not public | Founder Q: DL trigger / auth |
| 3 | UX: real Recording UI with demo data shown during download | Founder Q: 통합 형태 |
| 4 | Wizard precedes demo, completion CTA in banner | Prototype v4 founder approval |
| 5 | Scope: alpha + GA + future model swap | Founder Q: 스코프 타겟 |
| 6 | Picker stays as advanced fallback (not deleted) | Reviewer #1 architecture |
| 7 | `models.json` schema unchanged; only filename renamed | §3 review consensus |
| 8 | Demo content stays Japanese always (alpha JA-first) | §2 review consensus |
| 9 | License acceptance at Q4 (post-demo understanding) | §2 review consensus |
| 10 | Hardware-tier filtering is client-side, not server | §1 reviewer P1 #5 |

---

## 2 — §1 System architecture (4 layers)

```
Cloudflare R2 ─ binaries (whisper.bin / llm.gguf / future 7B / license texts)
              ─ Access: signed URL only (1h TTL); raw bucket not directly readable
       ▲
       │ R2 access via aws-sdk/s3-compatible (Lambda → R2)
       │
AWS Lambda    ─ GET  /v1/models/manifest          (withAuth + flag-gated)
(backend/)    ─ POST /v1/models/download-event    (withAuth, telemetry sink)
              ─ Reads `backend/manifests/model-manifest.v1.json` (Lambda asset)
              ─ Re-signs R2 URLs (1h) per request
              ─ Filters by App-Version (User-Agent parse) and flag (off/allowlist/all)
              ─ R2 credentials only here, via Secrets Manager
       ▲
       │ HTTPS + Lisna JWT (Bearer)
       │
Desktop main  ─ NEW: src/main/model-downloader.ts
(desktop/)    ─ NEW: src/main/wizard-state.ts
              ─ Updates existing: src/main/ipc.ts (new channels)
              ─ Updates existing: src/main/model-resolver.ts (file rename migration)
              ─ Reuses: AbortController pattern, atomic-write pattern, Keychain JWT
       ▲
       │ contextBridge IPC (window.lisna.*)
       │
Desktop render ─ NEW route: SetupDownloadView (4-step wizard + demo Recording UI)
(desktop/)    ─ NEW component: ManifestUpdateBanner (in real Recording view)
              ─ NEW component: VaultPathCallout (one-shot in NoteView)
              ─ NEW component: SettingsModelsTab (Settings → Models)
              ─ Updates App.tsx FSM (adds `setup-download` state)
              ─ Updates Settings (picker moves to Advanced; new Models tab)
```

### 2.1 Layer 1 — Cloudflare R2

- **Bucket name** (proposed): `lisna-models-prod`
- **Stored objects**:
  - `<id>/<version>/<filename>` — binary model files (e.g. `kotoba-whisper-v2.0/q5_0/whisper.bin`)
  - `licenses/<license_id>.txt` — canonical license text we serve (so manifest's `license_text_sha256` can verify against a known source we control)
- **Access policy**: bucket is private. R2 access key in Lambda's `AppSecret` (`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`). Lambda signs URLs (1h TTL) per request.
- **Versioning**: ON (allows revert if a model upload is corrupted post-publish).
- **Cross-region replication**: OFF for alpha (cost; +20%). Accepted RPO = 7 days (worst case: lose latest hand-edited `model-manifest.v1.json` commit, revert from git).
- **Region**: R2 doesn't expose region; automatic routing.

### 2.2 Layer 2 — AWS Lambda

Two new endpoints, both wrapped in the existing `withAuth<T>` (`backend/src/lib/auth.ts`):

#### 2.2.1 `GET /v1/models/manifest`

**Auth**: Bearer JWT. 401 → desktop's existing re-auth flow triggers via `lisna://`.

**Feature flag** (`MODEL_DOWNLOAD_ENABLED` env, `'off' | 'allowlist' | 'all'`):
- `off` → 503 with `{ code: 'MODEL_DOWNLOAD_NOT_YET_ENABLED' }`. Desktop falls back to picker silently.
- `allowlist` → checks user's email (from JWT) against `AppSecret.ALLOWLIST_EMAILS` comma-joined value. Match → manifest. Miss → 503 with `{ code: 'NOT_IN_ALLOWLIST' }`. Picker stays as fallback.
- `all` → manifest for every signed-in user.

**App-version gate** (`MIN_SUPPORTED_APP_VERSION` env, semver):
- Parse `User-Agent` header against `/^Lisna\/v(\d+)\.(\d+)\.(\d+)(?:-[\w.+-]+)?$/`.
- Malformed UA → 400 `{ code: 'INVALID_USER_AGENT' }`. No silent v1 fallback.
- `major.minor < MIN_SUPPORTED_APP_VERSION.major.minor` → 410 `{ code: 'APP_VERSION_UNSUPPORTED', minimum: '<semver>' }`. Desktop shows blocking "update required" modal linking to `lisna.jp/download`.

**Manifest version negotiation**:
- Lambda holds `manifest_version: 1` shape today; future v2 keeps both handlers until v1 clients sunset (rule below).
- Sunset rule: `manifest_v(N)` handler removed in the release where `MIN_SUPPORTED_APP_VERSION` ≥ first app version that ships v(N+1) understanding. Tracked in `backend/manifests/SUNSET.md`.

**Response body shape**:

```json
{
  "manifest_version": 1,
  "generated_at": "2026-05-25T10:00:00Z",
  "cache_max_age_seconds": 604800,
  "models": [
    {
      "slot": "stt",
      "id": "kotoba-whisper-v2.0-q5_0",
      "version": "2.0",
      "size_bytes": 1574862848,
      "sha256": "abc123…",
      "tier": "default",
      "lang": "ja",
      "license_url": "https://huggingface.co/kotoba-tech/kotoba-whisper-v2.0/blob/main/README.md",
      "license_id": "kotoba-whisper-tin",
      "license_text_sha256": "def456…",
      "url": "https://<signed-r2-url>/...?X-Amz-Signature=..."
    },
    {
      "slot": "llm",
      "id": "Llama-3.2-3B-Q4_K_M",
      "version": "3.2",
      "size_bytes": 2147483648,
      "sha256": "ghi789…",
      "tier": "default",
      "lang": "multi",
      "license_url": "https://www.llama.com/llama3_2/license/",
      "license_id": "llama-3.2-community",
      "license_text_sha256": "jkl012…",
      "url": "https://<signed-r2-url>/..."
    }
  ]
}
```

**Field semantics**:
- `manifest_version: number` — schema version. Bumps only on breaking changes (field meaning shift or required-field add). New optional fields don't bump.
- `generated_at: ISO8601 UTC` — Z-suffix mandatory.
- `cache_max_age_seconds: number` — client cache TTL. 604800 = 7d default. Shorter values for emergency push.
- `slot: "stt" | "llm"` — closed enum.
- `tier: "default" | "highmem"` — closed enum. Future `"highmem"` for 16GB+ Macs running 7B models. Client-side filtering decides what to install.
- `lang: "ja" | "en" | "multi" | …` — open enum. Multilingual model uses `"multi"`. Client picks based on Q2 wizard answer + manifest availability.
- `license_id: "kotoba-whisper-tin" | "llama-3.2-community" | …` — closed enum. License acceptance keyed on this (not `id` nor `id+version`); same `license_id` across version bumps = no re-prompt.
- `license_text_sha256` — SHA256 of canonical license text we host at `r2://licenses/<license_id>.txt`. Desktop verifies on Q4 mount. Drops dependence on `license_url` (Meta domain) being stable. `license_url` is display-only.
- `url` — signed R2 URL (1h TTL). Re-signed on every manifest fetch.

**Backend-internal manifest source**: `backend/manifests/model-manifest.v1.json`. Hand-edited in repo. Lambda bundles as asset. R2 URLs in source are NOT signed; Lambda signs at request time.

#### 2.2.2 `POST /v1/models/download-event`

Telemetry sink. Best-effort from client (5s timeout, no retry on send-failure — telemetry never blocks UX).

**Body**:
```json
{
  "event": "download.complete",
  "event_id": "uuid-v4",
  "timestamp": "2026-05-25T10:32:14Z",
  "app_version": "0.2.0",
  "os_family": "macos-26",
  "arch": "arm64",
  "payload": { "slot": "stt", "duration_ms": 92834, "resumed": false }
}
```

**Server-side**:
- Lambda extracts JWT `sub` → joins to `users.id` UUID → inserts that as `user_id` in `model_download_events` table. **Email never in event row.**
- Common-field bucketing at write: `os_version` → `os_family` (drop minor+build; e.g. `darwin-25.3.0-arm64` → `macos-26`); `arch` retained verbatim; `app_version` verbatim.

**Allowed event types** (closed enum):

| Event | Payload schema |
|---|---|
| `manifest.fetch.success` | `{ duration_ms, cached: boolean }` |
| `manifest.fetch.fail` | `{ duration_ms, code: string, attempt: 1..4, final_attempt: boolean }` |
| `download.start` | `{ slot, size_bytes }` |
| `download.progress.tick` | `{ slot, pct: 10..100 in deciles }` (not per-byte; only at 10/20/…/100) |
| `download.complete` | `{ slot, duration_ms, resumed: false }` (always false per never-resume rule) |
| `download.fail` | `{ slot, code, duration_ms, attempt }` |
| `download.cancel` | `{ slot, reason: CancelReason, bytes_at_cancel }` |
| `sha.mismatch` | `{ slot, expected_prefix: 8-char, got_prefix: 8-char }` |
| `recording_active_block` | `{ source: 'banner_click' \| 'settings_click' }` |
| `license.accept` | `{ license_id, manifest_version }` |
| `license.decline` | `{ }` (zero payload; quit modal coming next) |
| `picker.fallback` | `{ from_state: 'manifest_fail' \| 'sha_exhausted' \| 'user_choice' }` |
| `update_banner.show` | `{ manifest_version }` |
| `update_banner.dismiss` | `{ manifest_version }` |
| `update_banner.click` | `{ manifest_version }` |
| `vault_callout.show` | `{}` |
| `vault_callout.set_now` | `{}` |
| `vault_callout.later` | `{}` |
| `vault_callout.auto_dismiss_14d` | `{}` |

**Privacy**: no paths, no transcripts, only 8-char SHA prefix (never full hash), no email. Per JP APPI: `users.id` UUID is pseudonymous; joinable to `email` only via admin-role query against `users` table, with audit log. Internal joins are not third-party-provision (APPI 第28条 only triggers on export).

**Retention**:
- Raw `model_download_events` table: 90 days. Lambda cron purges 90d+ daily.
- Weekly rollup `model_download_weekly_agg` populated by cron with `GROUP BY (user_id, model_id, week_start, event_type)`. Preserves per-user crash signal at week granularity.
- Volume projection: ~2k events/month per 100 users → ~25k rows/year per 100 users. Acceptable through 10k MAU on RDS without partitioning.

#### 2.2.3 Migration table

New migration: `backend/src/migrations/NNN_model_download_events.sql` (NNN = next monotonic per `.claude/rules/workflow.md (migration)`).

```sql
CREATE TABLE IF NOT EXISTS model_download_events (
  event_id    uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id),
  timestamp   timestamptz NOT NULL,
  event_type  text NOT NULL,
  app_version text NOT NULL,
  os_family   text NOT NULL,
  arch        text NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX idx_mde_user_time ON model_download_events (user_id, timestamp DESC);
CREATE INDEX idx_mde_type_time ON model_download_events (event_type, timestamp DESC);

CREATE TABLE IF NOT EXISTS model_download_weekly_agg (
  user_id     uuid NOT NULL REFERENCES users(id),
  model_id    text NOT NULL,
  week_start  date NOT NULL,
  event_type  text NOT NULL,
  count       int  NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, model_id, week_start, event_type)
);
```

### 2.3 Layer 3 — Desktop main process

New module: `desktop/src/main/model-downloader.ts`. See §4 for the state machine.

New module: `desktop/src/main/wizard-state.ts`. Persists wizard answers + draft.

Updated: `desktop/src/main/ipc.ts` adds new channels (see §4.2).

Updated: `desktop/src/main/model-resolver.ts` — file rename migration (see §4.5) + reads `installed-models.json` going forward. Picker logic itself unchanged.

### 2.4 Layer 4 — Desktop renderer

Updates `desktop/src/renderer/App.tsx` view FSM. New routes under `desktop/src/renderer/routes/SetupDownloadView/`. New components in `desktop/src/renderer/components/`. See §3 for FSM detail and §4.3 for component tree.

---

## 3 — §2 First-launch UX flow (FSM)

### 3.1 State machine

```
                       ┌──────────────────┐
                       │   App boot       │
                       └────────┬─────────┘
                                ▼
                   getAuthState() — signedIn?
                ┌───────────────┴──────────────┐
              NO                              YES
                ▼                              ▼
        ┌──────────────┐               getModelStatus()
        │  SignInView  │                      │
        └──────┬───────┘                      ▼
               │                installed-models.json paths exist?
            (lisna://                  ┌──────┴──────┐
             callback)                YES           NO
               │                       │             │
               └─────►ready────────────►            ▼
                                                  needs-setup-download
                                                  (NEW state)
                                                       │
                              ┌────────────────────────┼─────────────────────────┐
                              ▼                        ▼                         ▼
                       Wizard Q1 (lang,        Wizard Q2 (rec-lang)      Wizard Q3 (storage,
                       self-localized)                                    default = Lisna)
                              │                        │                         │
                              └────────────────►Q4 (license, hard-block)──►setup-download
                                                                                  │
                                                                ┌─────────────────┴─────────────────┐
                                                                │           parallel:                │
                                                                │  • demo Recording UI (JA)          │
                                                                │  • background download (R2)        │
                                                                └─────────────────┬─────────────────┘
                                                                                  │
                                                              ┌───────────────────┼───────────────────┐
                                                            완료 CTA (banner)             停止 (demo)
                                                                  │                              │
                                                                  ▼                              ▼
                                                       recording (empty, real)        finalizing→note
```

### 3.2 Routing rules

1. **Boot**: `getAuthState()` → not signed in → `SignInView`. Signed in → `getModelStatus()`.
2. **Models already valid**: `installed-models.json` paths exist on disk → `recording` state directly. Boot never blocks on manifest fetch.
3. **Models missing**: → `needs-setup-download` → enter wizard Q1.
4. **Wizard Q1 → Q2 → Q3 → Q4**: each step requires answer to enable Next. Back button on Q1-Q3 returns to previous. Q4 has Back-to-Q3 and Decline.
5. **After Q4 (accept)**: download starts in background. UI transitions to demo Recording UI (`setup-download` sub-state with banner showing progress).
6. **Download complete**: green CTA "데모 끝내고 시작 →" appears in banner. Click stops demo + transitions to empty `recording`.
7. **NoteView "← 처음으로" during setup-download**: restarts demo cycle. Never cancels download.

### 3.3 Edge-case matrix

| Condition | Behavior |
|---|---|
| **v0.1.x alpha upgrade** (existing Discord-acquired models) | Boot resolver reads `installed-models.json` (or migrates from `models.json`) → paths point to real files → `recording` directly. Background manifest check (§4.1) computes SHA against installed; if match, mark as adopted (no UI). If mismatch, surface in Settings → Models as "update available". Saves ~5 GB re-download. |
| **Network offline at first run** | Wizard Q1-Q4 still works (offline-capable). After Q4, manifest fetch fails → error screen with "매뉴얼 picker 로 진행 ↗" link to existing §5.1 picker. Once online, user can retry via Settings → "모델 업데이트 확인". |
| **Q4 license declined** | OS confirm dialog: "License is required to use Lisna on-device features. Quit Lisna?" (`dialog.showMessageBox`, `cancelId: 0, defaultId: 0` so accidental Enter doesn't quit). Cancel → back to Q4. OK → `app.quit()`. No partial-acceptance state. |
| **Cancel mid-download** | `models/download/cancel` IPC → AbortController fires → state → `cancelled`. `.partial` files left on disk. Swept on next boot if `mtime > 24h`. |
| **Disk full pre-check** | Before `start`, compute `requiredBytes = sum(manifest.models[].size_bytes) * 1.1 + 1_073_741_824`. `fs.statfs` checks `bavail * bsize`. Below threshold → `error: DISK_INSUFFICIENT` with `{ needed, available }`. UI: "디스크 공간 부족 (필요 N GB, 가용 M GB) — 공간 확보 후 재시도". |
| **SHA mismatch** | `unlink(.partial)` → retry once (full re-download from byte 0) → still mismatch = `error: SHA_MISMATCH`. UI: "다운로드 손상 — 재시도 1회 실패" + picker fallback offered. |
| **JWT expired mid-download** | 401 on chunk → `error: JWT_EXPIRED`. UI: "재로그인이 필요해요" + re-auth via `lisna://`. User must call `models/download/restart` (no auto-resume). Re-auth failure within 60s → degrades to `MANIFEST_FETCH_FAIL` with backoff (prevents infinite re-auth loop). |
| **Newer manifest version available** | After boot lazy manifest fetch, if `new.manifest_version > local.manifest_version`, render inline `ManifestUpdateBanner` at top of `recording` view. Dismissible per-version via `<userData>/dismissed-manifest-versions.json` (capped 50 entries, prune entries `< current - 10` on every read). |
| **Sign-out from any state** | Unmounts `AuthenticatedApp` → `SignInView`. Active downloads cancel via AbortController + preserve `.partial`. Wizard draft persists in `<userData>/wizard-draft.json` (slot-keyed). Re-sign-in resumes at `wizard-q?` of last completed +1, NOT Q1. Drafts > 30 days auto-purged on boot. (Sign-out implementation deferred per `App.tsx:51` comment, but contract is locked here.) |
| **Multi-window** | Single BrowserWindow invariant. Wizard + download FSM state lives in main-process (`model-downloader.ts` + `wizard-state.ts`), not renderer. `app.on('activate')` macOS-reopen returns the existing window; never creates a second one during `setup-download`. (No new-window UI today; forward-looking invariant.) |

---

## 4 — §3 Download state machine + IPC + filesystem

### 4.1 `DownloadState` (main process source of truth)

```ts
type DownloadState =
  | { kind: 'idle' }
  | { kind: 'fetching-manifest' }
  | { kind: 'downloading'; slot: 'stt' | 'llm'; bytes: number; total: number; etaSec: number; backoffWaitMs?: number }
  | { kind: 'verifying'; slot: 'stt' | 'llm' }
  | { kind: 'finalizing'; slot: 'stt' | 'llm' }     // fs.rename + installed-models.json write
  | { kind: 'complete' }
  | { kind: 'error'; code: ErrorCode; slot?: 'stt' | 'llm'; message: string }
  | { kind: 'cancelled'; reason: CancelReason };

type CancelReason = 'sign-out' | 'window-close' | 'user-cancel' | 'disk-full' | 'sha-mismatch';

type ErrorCode =
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
```

### 4.2 State transitions

| From | To | Trigger |
|---|---|---|
| `idle` | `fetching-manifest` | `models/download/start` IPC |
| `fetching-manifest` | `downloading` | manifest 200 + disk pre-check pass |
| `fetching-manifest` | `error` | manifest fail OR 410 OR disk fail |
| `fetching-manifest` | `cancelled` | AbortSignal |
| `downloading` | `verifying` | bytes === total |
| `downloading` | `error` | mid-stream 5xx after backoff exhausted; 401; FS write fail |
| `downloading` | `cancelled` | AbortSignal |
| `verifying` | `finalizing` | hash matches manifest.sha256 |
| `verifying` | `downloading` (retry) | hash mismatch + first retry |
| `verifying` | `error` | hash mismatch on retry (CHECKSUM_RETRY_EXHAUSTED) |
| `verifying` | `cancelled` | AbortSignal |
| `finalizing` | next slot OR `complete` | rename + installed-models.json write OK |
| `finalizing` | `error` | rename fails (very rare; FS_WRITE_FAIL) |
| `finalizing` | **ignores AbortSignal** | rename is O(ms); cheaper to let finish |
| `error` | `idle` | `models/download/restart` IPC (NEW channel — separates "user-initiated restart" from "first start" for telemetry) |
| `complete` | `idle` | app-restart OR `models/manifest/check` detects newer `manifest_version` |
| `cancelled` | `idle` | `models/download/start` (fresh attempt) |

### 4.3 Per-slot download loop (never-resume policy)

```ts
async function downloadSlot(slot, manifest, signal) {
  const partial = path.join(userData, 'models', `${slot}.partial`);
  const final = path.join(userData, 'models', slot === 'stt' ? 'whisper.bin' : 'llm.gguf');

  // NEVER resume: unlink any leftover .partial first.
  await fs.unlink(partial).catch(() => {});

  const fileFd = await fs.open(partial, 'w');
  const hash = crypto.createHash('sha256');

  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const resp = await fetch(manifest.url, { signal });
      if (resp.status === 401) throw new Error('JWT_EXPIRED');
      if (resp.status >= 500) throw new Error('R2_5XX');
      // ...stream-pipe response.body through hash AND writeStream simultaneously
      for await (const chunk of resp.body) {
        hash.update(chunk);
        await fileFd.write(chunk);
        emitProgress({ slot, bytes: hash.bytesProcessed, total: manifest.size_bytes });
      }
      break; // success
    } catch (e) {
      if (signal.aborted) throw e;                                       // → cancelled
      if (e.message === 'JWT_EXPIRED' || e.message === 'R2_5XX') {
        if (attempt === 4) throw new Error('R2_5XX');                    // → error
        await sleep([1000, 2000, 4000][attempt - 1]);
        // re-establish + restart from byte 0 (never-resume rule)
        await fileFd.close();
        await fs.unlink(partial);
        const newFd = await fs.open(partial, 'w');
        hash.update_reset();  // crypto.createHash reset
        emitState({ kind: 'downloading', slot, bytes: 0, total: manifest.size_bytes, backoffWaitMs: [1000, 2000, 4000][attempt - 1] });
        continue;
      }
      throw e;
    }
  }
  await fileFd.close();

  // Verify
  emitState({ kind: 'verifying', slot });
  if (hash.digest('hex') !== manifest.sha256) {
    await fs.unlink(partial);
    if (alreadyRetried) throw new Error('CHECKSUM_RETRY_EXHAUSTED');
    return downloadSlot(slot, manifest, signal); // ONE retry only, restarts from scratch
  }

  // Finalize (uninterruptible)
  emitState({ kind: 'finalizing', slot });
  await fs.rename(partial, final);
  await updateInstalledModels({ slot, path: final });
  return final;
}
```

**Multi-slot ordering**: Sequential — STT first, then LLM after STT completes. **No parallelism**. Rationale: JP residential uplink (typical 100 Mbps) saturates on a single 1.5 GB download; parallel halves both. If STT errors, LLM never starts.

### 4.4 SHA-check migration (separate from active download)

For v0.1.x users with Discord-acquired models or any previously-installed models, verify they match the manifest:

```ts
async function verifyExistingModels(opts: { manifest, signal: AbortSignal }) {
  const installed = await readInstalledModels();
  const result = { matched: [], mismatched: [] };
  for (const slot of ['stt', 'llm']) {
    if (signal.aborted) return result;
    const filePath = installed[slot + 'Path'];
    if (!filePath || filePath.endsWith('.partial')) continue; // skip partials
    const expected = manifest.models.find(m => m.slot === slot)?.sha256;
    const actual = await streamHash(filePath, signal);  // crypto.createHash + createReadStream, ~15s for 3.5GB
    (actual === expected ? result.matched : result.mismatched).push(slot);
  }
  return result;
}
```

**Trigger**: scheduled via `setImmediate` (Node global, main process) after first successful `getModelStatus()=ready` paint. Gated by `<userData>/manifest-check.json` flag:

```json
{ "lastCheckedAt": "ISO8601", "lastManifestVersion": 1, "mismatchedSlots": [] }
```

Re-runs only when:
1. Flag absent (first launch ever or post-uninstall)
2. `now - lastCheckedAt > cache_max_age_seconds`
3. User clicks "Check for updates" in Settings → Models

**Interruptible**: same `AbortController` as active download. Sign-out / app-quit cancels. Prevents 15s zombie CPU burn.

### 4.5 IPC channels

Added to `desktop/src/main/ipc.ts`:

| Channel | Direction | Payload | Returns |
|---|---|---|---|
| `models/download/start` | renderer → main, invoke | `void` | `{ ok: true }` or rejection with `RECORDING_ACTIVE` |
| `models/download/cancel` | renderer → main, invoke | `{ reason: CancelReason }` | `{ ok: true }` |
| `models/download/restart` | renderer → main, invoke | `void` (separates from `start` for telemetry) | `{ ok: true }` |
| `models/download/state` | renderer → main, invoke | `void` | `DownloadState` |
| `models/download/state-changed` | main → renderer, event | `DownloadState` (full state push, matches existing `models/status` pattern) | — |
| `models/manifest/check` | renderer → main, invoke | `{ force?: boolean }` | `{ updated: boolean, newManifestVersion?: number }` |
| `models/sidecar/reload` | renderer → main, invoke (also auto-fired by main on `complete`) | `void` | `{ ok: true }` |
| `models/telemetry/event` | main → renderer (forwarded out) OR direct main → POST | `{ event, payload }` | — |
| `models/wizard-draft/load` | renderer → main, invoke | `void` | `WizardDraft \| null` |
| `models/wizard-draft/save` | renderer → main, invoke | `WizardDraft` | `{ ok: true }` |
| `models/wizard-draft/clear` | renderer → main, invoke | `void` | `{ ok: true }` |

**`RECORDING_ACTIVE` lock**: `models/download/start` and `models/download/restart` reject with `RECORDING_ACTIVE` error if `recordingActive === true` in main (existing flag in `ipc.ts`). UI block stays in renderer, but main is the source of truth.

Preload bridge (`desktop/src/preload/index.ts`) exposes typed wrappers on `window.lisna`.

### 4.6 Filesystem layout

```
<userData>/
  models/
    whisper.bin                       — canonical Whisper STT model (sidecar reads)
    whisper.bin.partial               — in-flight download (always unlinked at start)
    llm.gguf                          — canonical Llama LLM model
    llm.gguf.partial
  installed-models.json               — { version: 1, sttPath, llmPath } (renamed from models.json)
  model-manifest.json                 — cached R2 manifest
  model-manifest-check.json           — { lastCheckedAt, lastManifestVersion, mismatchedSlots? }
  settings.json                       — { uiLang, recLang, vault: { provider, vaultPath|null, firstNotePromptShownAt? }, licenseAccepted: { [license_id]: { acceptedAt, manifestVersion } } }
  wizard-draft.json                   — { stepCompleted: 0..4, answers: { uiLang, recLang, storage, licenseAccepted } } (purged if mtime > 30d, or on enum drift)
  dismissed-manifest-versions.json    — number[], cap 50, prune entries < currentVersion - 10
```

**File rename migration** (Phase B single-release atomic step):

On every boot, `model-resolver.ts:loadModelsJson` performs:

```ts
const newPath = path.join(userData, 'installed-models.json');
const oldPath = path.join(userData, 'models.json');
const newExists = await fs.access(newPath).then(() => true, () => false);
const oldExists = await fs.access(oldPath).then(() => true, () => false);

if (newExists) {
  // Read new. If both exist (race), new wins; old gets unlinked (tie-breaker invariant).
  if (oldExists) await fs.unlink(oldPath).catch(() => {});
  return JSON.parse(await fs.readFile(newPath, 'utf8'));
}
if (oldExists) {
  // v0.1.x upgrade path: read old, write new, unlink old.
  const data = JSON.parse(await fs.readFile(oldPath, 'utf8'));
  await saveInstalledModelsJson(userData, data);   // writes to newPath via atomic-rename
  await fs.unlink(oldPath).catch(() => {});
  return data;
}
return null;
```

**Invariant comment to add in code**: "If BOTH `models.json` and `installed-models.json` exist (e.g. user runs old binary against new userData), the NEW name wins; old is unlinked. Never reverse this — it would silently revert post-rename users."

### 4.7 Wizard draft (`wizard-state.ts`)

```ts
type WizardDraft = {
  stepCompleted: 0 | 1 | 2 | 3 | 4;
  answers: {
    uiLang?: 'ja' | 'en' | 'ko' | 'auto';
    recLang?: 'ja' | 'en' | 'ko' | 'multi';
    storage?: 'lisna' | 'obsidian' | 'folder';
    licenseAccepted?: { [license_id: string]: { acceptedAt: string; manifestVersion: number } };
  };
};

function loadWizardDraft(): WizardDraft | null {
  const d = readJsonSafe('<userData>/wizard-draft.json');
  if (!d) return null;
  // Enum-drift defense: drop unknown values, clamp stepCompleted.
  const enums = { uiLang: ['ja','en','ko','auto'], recLang: ['ja','en','ko','multi'], storage: ['lisna','obsidian','folder'] };
  const stepIndex = { uiLang: 1, recLang: 2, storage: 3 };
  for (const [key, value] of Object.entries(d.answers)) {
    if (enums[key] && !enums[key].includes(value)) {
      delete d.answers[key];
      d.stepCompleted = Math.min(d.stepCompleted, stepIndex[key] - 1);
    }
  }
  // Discard stale drafts > 30d.
  if (mtime > 30 * 86400 * 1000) return null;
  return d;
}
```

### 4.8 Error → UI mapping

i18n keys in `desktop/src/renderer/i18n/messages-{en,ja,ko}.json` (separate catalog from web). Example for KO:

| Code | Message (KO) | Action |
|---|---|---|
| `NETWORK_OFFLINE` | "오프라인입니다" | "매뉴얼 picker 로 ↗" link + retry ↻ |
| `MANIFEST_FETCH_FAIL` | "모델 목록을 가져올 수 없어요" | 30s auto-retry + manual retry button |
| `JWT_EXPIRED` | "재로그인이 필요해요" | Trigger `lisna://` re-auth flow |
| `APP_VERSION_UNSUPPORTED` | "Lisna 업데이트가 필요해요. v{min}+ 로 업데이트하세요" | Modal blocking; link to `lisna.jp/download` |
| `DISK_INSUFFICIENT` | "디스크 공간 부족 (필요 N GB, 가용 M GB)" | Block until space freed + retry |
| `SHA_MISMATCH` | "다운로드 손상 — 재시도 1회 실패" | Picker fallback offered |
| `CHECKSUM_RETRY_EXHAUSTED` | "체크섬 검증 실패 — 매뉴얼 picker 권장" | Picker fallback offered |
| `FS_WRITE_FAIL` | "디스크 쓰기 실패 — 권한 확인" | OS permission deeplink |
| `R2_5XX` | "서버 일시 오류 — 재시도 중 ({attempt}/4)…" | Background backoff `[1s, 2s, 4s]`, UI shows attempt count |
| `RECORDING_ACTIVE` | "녹음 종료 후 가능해요" | Inline message in Settings → Models |

All copy lives in `messages-{en,ja,ko}.json`; never hardcoded. Pre-commit `check-i18n.mjs` (adapted from web's) enforces key parity.

### 4.9 Renderer component tree

```
App.tsx (existing, FSM updated)
└── AuthenticatedApp (existing)
    ├── (existing) Recording / Finalizing / NoteView / Error
    └── (NEW) SetupDownloadView
        ├── WizardStep (1 of 4)
        │   ├── LanguagePicker (Q1, self-localized — no Korean prose; cards in native script + flag)
        │   ├── RecordingLangPicker (Q2)
        │   ├── StoragePicker (Q3) — default Lisna; Obsidian option has inline ObsidianExplainer + "Obsidian 이 뭔가요?" expand
        │   └── LicenseGate (Q4) — checkbox + Decline triggers OS confirm dialog
        ├── DemoRecordingUI (post-Q4 mount, JA pre-canned content)
        └── DownloadProgressBanner (sticky top)
            └── "데모 끝내고 시작 →" CTA (when state=complete)

Recording (existing, real mode)
└── ManifestUpdateBanner (NEW; shown when newer manifest_version not dismissed)

NoteView (existing, real mode)
└── VaultPathCallout (NEW; one-shot on FIRST note when settings.vault.vaultPath===null && provider==='obsidian')

Settings (NEW or extend existing)
├── General (existing)
├── Models (NEW) — shows installed vs available, per-slot update buttons
└── Advanced (NEW) — relocated §5.1 picker
```

---

## 5 — §4 Updates + lifecycle

### 5.1 Manifest fetch cadence

```
Boot (signed in):
  → getModelStatus() === 'ready' → render Recording immediately (never blocks)
  → setImmediate(() => modelDownloader.checkManifest({ background: true }))
       reads model-manifest-check.json
       if now - lastCheckedAt < cache_max_age_seconds → SKIP (use cache)
       else fetch /v1/models/manifest with JWT
       on success → write cache + check-flag
       on failure → silent (next boot retries; no UI noise)

User-triggered (Settings → "모델 업데이트 확인"):
  → modelDownloader.checkManifest({ background: false, force: true })
       ignores cache TTL
       surfaces errors in Settings UI

After download `complete`:
  → cache freshly populated, no re-fetch needed

First-ever fetch (Q4 → setup-download):
  → BLOCKING on a spinner during the wizard's transition to demo
  → offline → manual picker link visible ("매뉴얼 picker 로 진행 ↗")
  → JWT expired → re-auth → if 2nd failure in 60s → degrade to MANIFEST_FETCH_FAIL
```

### 5.2 Update detection (on cache write)

```ts
const oldManifest = readJsonSafe('<userData>/model-manifest.json');
const newManifest = await fetchManifest();
const triggers = {
  versionBump: newManifest.manifest_version > (oldManifest?.manifest_version ?? 0),
  slotMismatch: detectShaMismatch(newManifest.models, readInstalledModels()),
  licenseChanged: anyLicenseIdChanged(oldManifest, newManifest),
};

// Drift check ALSO runs on every boot, independent of cache TTL — in-memory SHA
// compare of installed-models.json against cached manifest. Cheap.
const driftedNow = inMemoryCompareInstalledVsManifestSha(installed, cachedManifest);

if (triggers.versionBump || triggers.slotMismatch.length > 0 || driftedNow.length > 0) {
  showUpdateBanner({ versions: triggers, drifted: driftedNow });
}
if (triggers.licenseChanged) markLicenseReprompt();
```

### 5.3 Update apply

`ManifestUpdateBanner` click → Settings → Models tab. Layout:

```
─────────────────────────────────────────────────────────
 Whisper STT      v2.0 · sha:abc12…   ✓ 최신
 Llama LLM        v3.2 · sha:def34…   ↑ v3.3 사용 가능   [업데이트]
─────────────────────────────────────────────────────────
                                                [모델 업데이트 확인 ↻]
```

Per-slot "업데이트":
1. License change → modal preempts download (user must re-accept).
2. `models/download/restart` with `{ slot: 'llm' }` — single-slot variant of §4.3.
3. After `complete` → `models/sidecar/reload` automatically fires. Sidecar reload, not app restart.
4. If `recordingActive === true` → rejects with `RECORDING_ACTIVE` error at IPC boundary. UI inline message: "녹음 종료 후 가능해요".

### 5.4 Same-id SHA overwrite (model patch)

When `manifest.models[slot].id` unchanged but `sha256` differs (patch release):

```
1. models/sidecar/stop                 (existing sidecar IPC; releases file handle)
2. fetch + verify into <slot>.partial  (per §4.3, never-resume rule)
3. fs.unlink(<slot> final file)        (Windows v2 portability; macOS POSIX-safe either way)
4. fs.rename(<slot>.partial → final)
5. update installed-models.json (atomic)
6. models/sidecar/reload
```

Don't rely on POSIX rename-while-open semantics. Explicit unlink-before-rename for portability.

### 5.5 Backend deploy + manifest publish

- **Source of truth**: `backend/manifests/model-manifest.v1.json` hand-edited in repo.
- **R2 binary upload**: founder uploads new model to `lisna-models-prod/<id>/<version>/<filename>` (one-time manual until automated).
- **License text upload**: founder uploads canonical text to `lisna-models-prod/licenses/<license_id>.txt`.
- **Manifest update**: edit `model-manifest.v1.json` with new `sha256` + `license_text_sha256` + size. PR → main merge → `deploy-backend.yml` auto-deploys Lambda → effect on next client manifest fetch (up to `cache_max_age_seconds` lag).
- **CI verification**: new `.github/workflows/manifest-verify.yml` runs on PRs touching `backend/manifests/**`:
  - For each model in manifest: HEAD R2 URL → compare `Content-Length` to `size_bytes`. (4KB peek separately checks R2 liveness via range-GET first 4KB.)
  - For each model: full-file streaming SHA256 download (single `createReadStream` pass) → compare to manifest's `sha256`. Cache by R2 key hash in `.ci-manifest-cache/` to skip unchanged entries on subsequent runs.
  - For each license: HEAD `r2://licenses/<license_id>.txt` + SHA verify against `license_text_sha256`.
  - Local script `pnpm verify:manifest` mirrors CI for founder pre-commit.

### 5.6 Schema migration (manifest_version bump)

Bump only on **breaking** changes (field meaning shift or required-field add). New optional fields = no bump.

Backend keeps v(N) and v(N+1) handler code until v(N) clients sunset. Sunset rule: v(N) handler removed when `MIN_SUPPORTED_APP_VERSION` ≥ first app version that ships v(N+1) understanding. Tracked in `backend/manifests/SUNSET.md`.

### 5.7 Model swap policy

| Case | Behavior |
|---|---|
| **New `id` for same slot** (e.g. Llama 3.2 → 3.3) | `installed-models.json` slot path jumps to new file. Old file unlinked. |
| **Same `id`, new `sha256`** (patch release) | Overwrite in place per §5.4 sequence. Sidecar stop → swap → reload. |
| **Old model retention** | NO — single slot, single file. User wanting old model must manually back up before update (responsibility on user). |
| **A/B testing per cohort** | Out of scope for v2.0. Manifest schema doesn't carry cohort field. |

---

## 6 — §5 Rollout · telemetry · phasing

### 6.1 Feature flag

`MODEL_DOWNLOAD_ENABLED: 'off' | 'allowlist' | 'all'` env var on Lambda.

- `off` (initial ship): `/v1/models/manifest` returns 503 with `MODEL_DOWNLOAD_NOT_YET_ENABLED`. Desktop falls back to picker silently. No user-visible change.
- `allowlist` (alpha rollout): Lambda checks JWT email against `AppSecret.ALLOWLIST_EMAILS` (comma-joined value).
- `all`: every signed-in user receives manifest.

**Allowlist audit trail**: source = `infra/allowlist-emails.json` checked into repo. CDK reads at deploy → syncs to Secrets Manager. `git log -p infra/allowlist-emails.json` is the audit trail. **No raw Secrets Manager console edits.** Operational scale ceiling: ~500 entries; beyond that, migrate to DB-backed allowlist (F2 follow-up).

**App-version EOL**: `MIN_SUPPORTED_APP_VERSION` env (semver). Backend returns 410 `APP_VERSION_UNSUPPORTED` if client UA < min. Desktop shows blocking modal linking to download. v0.1.x EOL triggered manually when Phase E is `all`.

Picker **always available** regardless of flag — no flag controls it.

### 6.2 Telemetry taxonomy

See §2.2.2 for the event list and common fields. Recap of key points:

- `user_id` = `users.id` UUID via JWT→DB lookup at write time (Lambda). Email never in event row.
- `os_family` bucketed at write (drops minor+build).
- 8-char SHA prefix only (never full hash).
- 90d raw retention; weekly rollup.
- No transcripts, no paths.

### 6.3 Open questions / residual risks

1. **R2 region opacity** — R2 doesn't expose region. Target metric: **p95 manifest fetch < 500ms from JP IPs**. CloudWatch dashboard `model-download-health` built in Phase D (panels: fetch latency p95 by geo, download success rate, sha.mismatch rate by model, RECORDING_ACTIVE rejection rate).
2. **License URL drift** — solved via `license_text_sha256` on manifest. Canonical license text in our R2; `license_url` (Meta original) display-only.
3. **First-launch all-paths-fail deadlock** — locked: every fetch-failure UI surfaces "매뉴얼 picker 로 진행 ↗" link.
4. **Sidecar reload latency** (was open #4, now residual) — target p99 < 3s end-to-end; instrument via `models.sidecar.reload.duration_ms` event. Measure in Phase D.
5. **R2 disaster recovery** — versioning ON, cross-region replication OFF (cost). Accepted RPO = 7d for alpha (worst case: lose latest manifest commit, revert from git). Documented in `backend/manifests/README.md`.

### 6.4 Phasing

| Phase | Scope | Gate / dependency |
|---|---|---|
| **A — Foundation** (flag = `off`) | Lambda endpoints (`/v1/models/manifest`, `/v1/models/download-event`), `model_download_events` + `model_download_weekly_agg` tables, CDK changes, `backend/manifests/model-manifest.v1.json`, R2 bucket setup, first model + license uploads, CI `manifest-verify.yml`. **No desktop behavior change** (flag=off → picker fallback active). | Independent of B. Single PR. |
| **B — Desktop main** | `src/main/model-downloader.ts`, `src/main/wizard-state.ts`, IPC channels, AbortController integration, **atomic single-release file rename migration** (`models.json` → `installed-models.json`). | A+B parallel-developed; **B ships as one release** (no half-state on user's disk). |
| **C — Renderer UI** | `SetupDownloadView` + 4 wizard step components, `DemoRecordingUI` (uses prototype-validated JA content), `DownloadProgressBanner`, `ManifestUpdateBanner`, `VaultPathCallout`, Settings Models tab, i18n catalog `messages-{en,ja,ko}.json`. | Phase B IPC complete. **Exit criteria**: en/ja/ko parity enforced by adapted `check-i18n.mjs` pre-commit + CI. |
| **D — End-to-end** | Flag flip `off → allowlist`. Founder + ≥1 invited tester on allowlist. CloudWatch dashboard `model-download-health` built. Real R2 download exercised. v0.1.x migration verified on founder's machine. Telemetry wiring end-to-end. | Phase C merged. |
| **E — Polish + rollout** | Flag flip `allowlist → all`. Picker moves to Settings → Advanced. Error message polish. v0.1.x EOL signaling enabled. | **D → E measurable gate** (all four required): ≥3 successful `download.complete` events from ≥2 distinct non-founder allowlist users; 0 `sha.mismatch` events in trailing 14d; `manifest.fetch.fail / (success + fail)` rate < 1% over trailing 14d; founder review of 7-day weekly rollup dashboard. |

A+B parallel-developable. C/D/E sequential.

---

## 7 — Follow-ups (deferred to plan)

Captured for the implementation plan; do not block spec freeze.

| # | Item | Where it lands |
|---|---|---|
| **F1** | R2 egress cost budget reviewed quarterly (current alpha scale negligible; 10k MAU × quarterly swap ≈ ~60TB/yr egress) | `backend/manifests/README.md` + ops checklist |
| **F2** | Allowlist DB migration when `infra/allowlist-emails.json` exceeds ~500 entries | Plan task; introduce DB-backed allowlist (`allowlist_emails` table) |
| **F3** | Admin-query audit log scope clarification — APPI 第28条 third-party-provision concern only on export; internal joins are fine | `backend/docs/data-access-policy.md` (NEW) |
| **F4** | Manifest schema migration bullet under §5.5 Phase A: `manifest_version` field bumps trigger desktop hard-refresh; v0.1.x clients see 410 once we ship v2 (gated by `MIN_SUPPORTED_APP_VERSION`) | `backend/manifests/SUNSET.md` |
| **F5** | Atomic-rename tie-breaker invariant comment: "if both `models.json` and `installed-models.json` exist, NEW wins; old gets unlinked." | Code comment in `model-resolver.ts:loadInstalledModelsJson` |
| **F6** | Add Desktop model storage subsection to `.claude/rules/architecture.md` | Plan task — final cleanup |

---

## 8 — Open verification commands (for plan + impl)

```bash
# Confirm AbortController pattern (used by §4.3 + §4.4)
grep -rn "AbortController\|signal:" /Users/guntak/Lisna/desktop/src/main/

# Confirm atomic-write pattern reused
grep -rn "saveModelsJson\|atomic" /Users/guntak/Lisna/desktop/src/main/model-resolver.ts

# i18n parity check (after Phase C)
cd /Users/guntak/Lisna/desktop && pnpm check-i18n         # NEW script

# CI manifest verification (after Phase A)
cd /Users/guntak/Lisna && pnpm verify:manifest             # NEW script
```

---

## 9 — Sign-off

This spec consolidates 5 design sections, each independently reviewed and approved by a fresh reviewer agent. The prototype that validated UX decisions is preserved at `.superpowers/brainstorm/49787-1779694035/content/production-clickthrough-v4.html`.

**Next step**: founder review of this spec, then invoke `superpowers:writing-plans` to produce the implementation plan.
