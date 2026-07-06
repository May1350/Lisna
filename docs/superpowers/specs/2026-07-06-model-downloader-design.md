# In-app first-run model downloader — design

**Date:** 2026-07-06
**Status:** approved (design), pending implementation
**Supersedes:** the Discord-file-distribution first-run flow (`ModelPickerStep` "Discord #lisna-alpha から届いたファイルを選択")

## Goal

On first run, let the user get Lisna's two on-device models with **one click**, downloaded directly from their official HuggingFace repos — no Discord, no manual file hunt, no re-hosting. The app is usable "받으면 알아서 준비" without the founder shipping model files by hand.

## Non-goals

- Not bundling models in the `.dmg` (2.4 GB > GitHub's 2 GB asset limit; bloats every update). Rejected in favor of first-run download.
- Not self-hosting the weights (no `models-latest` release). HuggingFace-direct means we are **not the redistributor** → no Llama-license/attribution obligation.
- Not byte-range **resume** in v1 (a failed download restarts that one file). Noted as a future upgrade.
- Not auto-update delivery of the downloader itself — that's gated on Developer-ID signing ($99); until then the new build ships via a manual re-download from lisna.jp.

## Source of truth: `catalog.ts` (already exists)

`desktop/src/shared/models/catalog.ts` already holds, for each default model, everything the downloader needs — `filename`, `sizeBytes`, `sha256`, and `source.url` (the HuggingFace `resolve/main/...` URL). The downloader **reads `DEFAULT_MODELS`**; no new source-of-truth. Current defaults:

- STT: `ggml-large-v3-turbo-q5_0.bin` — 574 MB — `394221…a7e2` — `huggingface.co/ggerganov/whisper.cpp`
- LLM: `Llama-3.2-3B-Instruct-Q4_K_M.gguf` — 1.88 GB — `6c1a2b…28ff` — `huggingface.co/hugging-quants/…-GGUF`

(Both HF repos are ungated → anonymous download works.)

## UX (SetupView)

First run (no models resolved → `needs-setup`) shows a **download-first** screen instead of the picker:

> 「Lisna は AI モデルをダウンロードします（合計 約2.4GB・初回のみ）」 + **[ダウンロード]** button.

- **Button, not silent auto-start** — 2.4 GB shouldn't start without one tap + a size disclosure (metered/slow connections).
- On click → sequential download with a per-model progress line reusing the existing step indicator: 「文字起こしモデル … 45%」 then 「ノート生成モデル … 12%」. Overall "ステップ N / 2" stays.
- On both complete → `models.json` written → `ready` → the existing 300 ms auto-redirect to Recording.
- **Fallback picker preserved:** a small 「すでにファイルがある場合は選択」 link reveals the current `ModelPickerStep` (offline / advanced users who already have the files). Don't delete working functionality.

## Architecture

### `main/model-downloader.ts` (new)

Pure-ish, injected for tests (mirrors `model-resolver.ts`'s pure-fn + `register*` shape).

- `downloadModel(descriptor, destDir, { onProgress, fetchImpl })`:
  1. Free-disk guard: require ≥ `sizeBytes + 512 MB` on `destDir`'s volume, else throw `INSUFFICIENT_DISK`.
  2. Stream `descriptor.source.url` (follow 302 → HF CDN) to `<destDir>/<filename>.part`, emitting `{ received, total }` progress.
  3. On completion, verify sha256 == `descriptor.sha256`; mismatch → delete `.part`, throw `CHECKSUM_MISMATCH`.
  4. Atomic `rename(.part → <filename>)`. Return the final path.
- `registerModelDownloadIpc(deps)`: registers `models/download` — runs STT then LLM via `downloadModel`, pushes `models/download-progress` events (slot, received, total, phase), writes `models.json` via the existing `saveModelsJson`, recomputes status via `resolveModels`, and calls `onStatusChange` (same seam `model-resolver` uses so `getModelPaths()` sees fresh paths). Typed `DownloadResult` union like `PickResult`.

### IPC + preload

- `models/download` (invoke) → `DownloadResult` (`{ok:true,status}` | `{ok:false,code}`).
- `models/download-progress` (main→renderer push) → `{ slot, received, total }`.
- preload: `downloadModels()` + `onModelDownloadProgress(cb)`.

### Renderer

- `SetupView`: new `downloading` state driving a `ModelDownloadStep` component (button → progress bars → error+retry). Reuses `toFriendlyJa` for error codes. Keeps `ModelPickerStep` behind the fallback link.
- On error: typed code → JA copy + **[再試行]** (restarts the failed file; completed files are skipped because they already exist on disk).

## Save location + resolver

Models land in `<userData>/models/<catalog filename>`; `models.json` points there. The existing **path-based** `resolveModels` consumes them unchanged — **no resolver change**.

## Web + docs

Fix the download page's now-wrong copy: the "advanced / `models-latest`" 404 reference → "models download automatically on first launch." (`web/src/app/[locale]/download/page.tsx` + `messages/{en,ja,ko}.json` `downloadPage.*`; run `check:i18n`.)

## License

HuggingFace-direct: user pulls from the models' official public repos, so **Lisna is not redistributing** — no bundled Llama license / attribution obligation. (If we ever move to self-hosting, this section changes.)

## Error handling (typed codes)

`INSUFFICIENT_DISK` · `CHECKSUM_MISMATCH` · `NETWORK_FAILED` (fetch/stream error, incl. non-200) · `MODEL_SAVE_FAILED` (models.json write). All surface as JA copy + retry; nothing throws raw to the renderer (same discriminated-union contract as `models/pick`).

## Testing (TDD)

Boundary-mocked (`fetchImpl` injected — never hit the real network in unit tests):
- `downloadModel`: happy path writes final file + correct progress sequence; **sha256 mismatch → deletes `.part` + throws** (fail-first verified); non-200 → `NETWORK_FAILED`; disk guard → `INSUFFICIENT_DISK`; atomic — a mid-stream throw leaves no `<filename>` (only a `.part`, cleaned).
- `registerModelDownloadIpc`: both-slots success writes `models.json` + emits `onStatusChange(ready)`; a slot failure preserves the other + reports the code.
- `SetupView`/`ModelDownloadStep`: `renderToStaticMarkup` — button state, progress state, error+retry state; fallback-picker link present.

## Delivery sequence (operational)

1. Implement (TDD, independent review) on a branch off `feat/recording-titles` (or main once #155/#156 merge) → version bump 0.1.37.
2. Push → pre-push review gate → tag `v0.1.37` → release.yml publishes → lisna.jp auto-serves 0.1.37.
3. Delete the local `/Applications/Lisna.app`, re-download 0.1.37 from lisna.jp → experience the button→progress→ready flow (Gatekeeper "Open Anyway" once, since still unsigned).
