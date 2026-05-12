# Manual Verification Log — desktop

Records of one-off runtime verifications that can't be fully automated.

## cb({}) deny semantics — Electron 39 (verified DEFERRED)

- Setup: macOS dev environment, `pnpm --filter @lisna/desktop dev`
- Steps:
  1. In a renderer context where `desktopCapturer.getSources()` returns `[]` (or temporarily stub to force the empty path), call `navigator.mediaDevices.getDisplayMedia({ audio: true })`
  2. Confirm the returned promise rejects (NOT: hangs, NOT: resolves to an empty stream)
- Expected: promise rejects with `NotFoundError` or `NotAllowedError`
- Result: DEFERRED — no live macOS Electron runtime in the agent session that locked this contract (2026-05-13). The unit test (`src/main/audio/__tests__/system-audio-handler.test.ts`) covers the call-shape contract; this entry is a placeholder to be filled when a live env is available.
- Electron version observed: DEFERRED

## Capture → chunker → main IPC end-to-end (Task 1.5, DEFERRED)

- Setup: macOS dev environment, `pnpm --filter @lisna/desktop dev`, microphone available
- Steps:
  1. Open the Recording route, click "Start"
  2. Speak for ~15 seconds, then click "Stop"
  3. Watch the main-process console (electron-vite stdout)
- Expected:
  - `chunk received 0 32000 samples` at ~2s after start (first chunk = 2s × 16kHz)
  - `chunk received 1 160000 samples` at ~12s (second chunk = 10s × 16kHz)
  - A residual `chunk received N <leftover> samples` after Stop (flush)
  - Renderer's "Chunks captured" counter increments alongside each main-side log
- Open questions for the live run:
  - Confirm `new URL('./pcm-worklet.js', import.meta.url)` resolves in both dev (electron-vite serves) and packaged (file://) builds; if not, move `pcm-worklet.js` under `src/renderer/public/` and switch to a `/pcm-worklet.js` string URL
  - Confirm Float32Array survives the IPC structured clone with `samples.length === payload.samples.length` (no truncation, no detach); the fallback is to send `samples.buffer` (ArrayBuffer) and reconstruct on the main side
- Result: DEFERRED — no live Electron runtime available in the agent session that wrote this code (2026-05-13). Unit tests in `src/renderer/audio/__tests__/orchestrator.test.ts` cover the orchestrator state machine; the AudioWorklet + IPC wiring will be exercised in Phase 2 when the whisper sidecar consumer is plugged in.
