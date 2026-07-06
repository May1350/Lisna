# First-run onboarding redesign — smart auto-detect + legal-pad pencil (dark)

**Date:** 2026-07-06
**Status:** approved (design), pending implementation
**Builds on:** 2026-07-06-model-downloader (0.1.37) — reuses `downloadModel`, `DEFAULT_MODELS`, `models/download` IPC, `saveModelsJson`, `resolveModels`.
**Supersedes:** the bare-inline-styles `SetupView` / `ModelDownloadStep` / `ModelPickerStep` screens.

## Goal

Make the first-run screen (a) **big + simple** — fill the window, one action; (b) **smart** — clicking はじめる auto-detects existing valid models and skips re-downloading, starting immediately if nothing is needed; (c) **on-brand** — the app's own dark theme + a legal-pad colored-pencil touch (hand-drawn check / progress / underline via our `#pencil-rough` SVG filter, Klee One JA handwriting).

## Non-goals

- Not touching the recording / notes **work surfaces** — pencil/handwriting stays on the onboarding (brand/low-density surface) only, per `web-design.md` scope-boundary. Work surfaces keep tokens, not decoration.
- Not a light "paper" onboarding — founder chose the **dark** app theme as the ground (pencil accents on dark), not the cream legal-pad surface.
- Not byte-range resume of a failed download (unchanged from 0.1.37).
- Not keeping the manual file **picker** in the onboarding flow (auto-detect replaces it).

## UX (dark, centered, one action)

`SetupView` shows a single centered hero, generous whitespace (content centered in the whole window, not a 560px top-left block). States:

1. **idle** — headline **`Lisna`** (Klee One), muted sub 「文字起こしとノート生成のモデルを確認します。必要な場合のみダウンロードします。」, one big primary button 「はじめる」 (Klee One label + hand-drawn pencil border), disclosure 「初回のみ・最大 約2.6GB」. No "L" chip. No picker link.
2. **checking** — spinner + 「モデルを確認しています」 while auto-detect runs.
3. **downloading** — only for slots that actually need it: a **pencil** progress bar (two segments, one per model) + 「<model> NN%」. Shown only when ≥1 slot downloads.
4. **done** — a **hand-drawn green** check (`#7fbf95`, pencil filter) + 「準備が完了しました」 + the existing 300 ms auto-redirect to Recording.
5. **error** — typed code → `toFriendlyJa` + 「再試行」 (calm inline, no hard red box).

If auto-detect finds both models valid, **checking jumps straight to done** (no download UI).

### Type / pencil

- **Klee One** (Google Fonts, SIL OFL — bundleable) added as a local `@font-face` in the renderer, used for the handwritten elements (`Lisna`, headline, button label). Body/sub text stays SF (`--lz-font`) for legibility. Latin `Lisna` may use Klee One or brand Caveat — default Klee One.
- **`#pencil-rough`** SVG filter (feTurbulence + feDisplacementMap, ported verbatim from `web/src/app/layout.tsx`) defined once in the renderer; plus a `#pencil-grain` variant (double-displacement) for colored-pencil texture. Applied to: the `Lisna` wordmark (light grain), the check path, the progress fill, the button border. Restraint: ≤ a few pencil accents (per `web-design.md`).
- Colors from `theme.css` dark tokens: burgundy `--lz-accent`, success `--lz-success`, tracks/borders as-is. Pencil red option = `#d23b3b`; green check = success token.

## Detection logic (the smart part) — NEW

On はじめる, for each core slot (`stt`, `llm`) find an already-present **correct** copy before downloading.

- **"correct latest version" = sha256 matches `DEFAULT_MODELS[slot].sha256`** (catalog is the single source of truth). A file that exists but whose sha256 differs is the wrong/old model → treated as not-found → download the correct one. (Magic-bytes validation in the existing `resolveModels` is NOT sufficient — it accepts any valid `.gguf`/`.bin`, not the specific model.)
- **Fast rejection:** a candidate must exist AND `statSync(path).size === DEFAULT_MODELS[slot].sizeBytes` before we sha256 it (avoids hashing 2 GB of a wrong file).
- **Where to look (founder: "앱 폴더 + 이전 위치 기억")** — prioritized candidate paths per slot:
  1. `<userData>/models/<catalog filename>` (canonical download dir — resume / re-run).
  2. Paths from an existing `models.json` if present (and, transitionally, a sibling `models.json.freshux-backup`) — covers files the user already had elsewhere (e.g. the founder's `~/.lisna-test-models/`).
  3. A persisted **known-locations** record (`<userData>/model-locations.json`, `{stt:[paths], llm:[paths]}`) accumulated whenever a model is downloaded / detected / adopted — the durable "remember prior locations".
- **`detectExistingModel(descriptor, userDataDir, deps?) → Promise<string|null>`** returns the first candidate that passes size+sha256, else null. `deps` injects `sha256File` / `statSize` / candidate sources for tests.
- **Prepare flow** (extends the `models/download` handler): for each slot → `detectExistingModel`; the slots that return null are downloaded via the existing `downloadModel` (progress events only for those); then `saveModelsJson(userDataDir, {version:1, sttPath, llmPath})` with the adopted/downloaded paths, update `model-locations.json`, `resolveModels`, `onStatusChange`. Return the same `DownloadResult` union. If both detected → no download, `{ok:true, status:ready}` immediately.

## Architecture (files)

- `desktop/src/main/model-detect.ts` (new) — `detectExistingModel` + `sha256File` + candidate-path resolution + `model-locations.json` read/append. Pure-ish, injected for tests.
- `desktop/src/main/model-downloader.ts` — `registerModelDownloadIpc` gains the detect-first step (download only missing slots; adopt; update known-locations).
- `desktop/src/renderer/routes/SetupView.tsx` — remove picker default/route + `initialError` picker path; drive the redesigned `ModelDownloadStep`; keep `handleResolved`.
- `desktop/src/renderer/components/ModelDownloadStep.tsx` — redesigned dark hero + checking/downloading(pencil)/done(pencil check)/error states; no `use-picker`.
- `desktop/src/renderer/components/ModelPickerStep.tsx` — removed from the onboarding flow (delete if no other consumer; `pickModel` IPC becomes dead → cleanup task).
- `desktop/src/renderer/theme.css` (or a new `onboarding.css`) — `.lz-onb-*` classes for the hero layout + pencil element styles; the `#pencil-rough`/`#pencil-grain` SVG filters live in `App.tsx` (hidden svg, once).
- `desktop/src/renderer/i18n/setup-strings.ts` — new/updated JA copy (headline `Lisna`, checking, disclosure); drop picker/Discord strings if the picker is deleted.
- `desktop/resources/fonts/KleeOne-Regular.woff2` (bundled) + `@font-face`.
- `desktop/package.json` — version bump (0.1.38).

## Testing

- `detectExistingModel` (boundary-mocked, no real fs/hash): valid file (size+sha256 match) → returns path; size-mismatch → null WITHOUT hashing (assert the sha256 fn not called); sha256-mismatch → null; missing → null; candidate priority (userData before known-locations); adopts the first match.
- `registerModelDownloadIpc` (extended): both slots detected → NO `downloadImpl` call, models.json written, `onStatusChange(ready)`; one slot missing → downloads exactly that slot; version-mismatch on disk → downloads.
- `ModelDownloadStep` (`renderToStaticMarkup`): idle renders はじめる + no `use-picker`; error state renders retry. (progress/pencil/interaction verified live in-app.)
- Font + pencil rendering = **visual verification** in the packaged app (rebuild → screenshot), not unit tests.

## Delivery

Implement (TDD + independent review, same gate flow as 0.1.37) on a branch off `feat/recording-titles` → version bump 0.1.38 → rebuild `/Applications/Lisna.app` → founder smokes the はじめる → (detect | download) → done flow + judges the pencil/Klee One look → iterate on grain/color.
