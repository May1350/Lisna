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
