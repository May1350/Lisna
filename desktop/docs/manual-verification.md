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

## macOS 13 (Darwin 22.x) graceful fallback — verified DEFERRED

- Setup: run on actual macOS 13 OR force `os.release()` stub in `hardware-check.ts` to return `"22.6.0"` temporarily (the threshold is Darwin 23.4 ≈ macOS 14.4, so anything below trips the fallback path)
- Expected on macOS 13 (or stubbed):
  1. Recording route loads without errors
  2. The "System audio" radio button is `disabled` (greyed; the disabled state is the affordance — not hidden)
  3. `SystemAudioUnavailableNotice` (`#fff7e6` aside) is visible below the source picker with the macOS 14.4 explanation copy
  4. Mic-only recording still works end-to-end (Start → speak → Stop → chunk counter increments, no console errors)
- Expected on macOS 14.4+ (sanity baseline):
  1. System-audio radio is enabled and selectable
  2. The notice is NOT rendered
- Result: DEFERRED — no macOS 13 machine in agent session; full manual matrix lands at Phase 6.4 per the on-device v2 plan. Unit tests in `src/main/platform/__tests__/hardware-check.test.ts` pin the Darwin 23.4 threshold (23.3 → false, 23.4 → true), which is the load-bearing branch.
- Electron / macOS versions observed: DEFERRED

## Capture → sidecar → live JA captions (Task 2.7, PASS 2026-05-13)

- Setup:
  - macOS 15.x dev environment, `LISNA_DEV_STT_MODEL=~/.lisna-test-models/ggml-kotoba-whisper-v2.0-q5_0.bin pnpm --filter @lisna/desktop dev`
  - Model: `ggml-kotoba-whisper-v2.0-q5_0.bin` (Q5_0, 538 MB, sha256 `4a3b9219…03658`)
  - Microphone permission granted to Electron
- Steps:
  1. Boot path: main process logs `[sidecar] ready` (sidecar reaches its `ready` event over NDJSON) and `[stt] model loaded from <path>` (WhisperCppSTT.loadModel resolved)
  2. Open the Recording route — UI shows `Lisna v2 — on-device` / `Recording` / Source picker / Start button. Header no longer says "Phase 1 stub"
  3. Click Start, speak Japanese in a live classroom for ~2 minutes (13 chunks ≈ 2s + 12×10s), click Stop
- Expected:
  - Main-process log shows `chunk received N M samples` for each captured chunk (renderer-side `Chunks captured: N` increments alongside)
  - `Live captions` section appears under the Stop button with `[startSec] text` lines accumulating
  - Each chunk's segments push back through `recording/chunk-result` and append to the renderer's segment list while a session is running
  - Stop clears the running flag synchronously; any late `transcribe()` result that resolves post-Stop is silently dropped (no cross-session bleed)
- Observed:
  - 13 chunks captured, 6 caption lines rendered with recognizable Japanese phrases drawn from the lecture audio (`組織の形が変わっていく時に発生する問題`, etc.)
  - No crash, no UI error state, no console errors
  - "Chunks captured: 13" counter consistent with audio length
- Known limitations (NOT regressions — by design at this phase; tracked in plan §Phase 4-5):
  - **Timestamps display chunk-relative `startSec`, not recording-absolute time.** `ChunkResultPayload.startMs` is carried but not yet rendered. Phase 4 UI polish will fold `startMs + segment.startSec` into a wall-clock label.
  - **No chunk overlap or VAD.** A word straddling a 10-second chunk boundary is cut, producing short fragments or empty hallucinated lines. Phase 5 (memory soak + transcript stitching) handles this with sliding-window chunks and silence-gating.
  - **Q5_0 quantization (538 MB) trades quality for size.** Phase 4's model registry will expose the full 1.52 GB Kotoba-Whisper as an opt-in for users who prioritize accuracy.
  - **Whisper silence-hallucinations occur on low-energy chunks** (canonical examples: `どうもありがとうございました`, `字幕`). Phase 4-5 will gate transcription on a VAD threshold and optionally pass the previous segment as `initial_prompt` for context continuity.
  - **Supervisor restart loses the loaded model.** `SidecarSupervisor` respawns the sidecar binary on crash (`src/main/sidecar/supervisor.ts:99-102`), but `src/main/index.ts:43-65` captures the initial `SidecarClient` reference into a closure and hands that exact instance to `WhisperCppSTT`. After a crash + respawn, the adapter still points at the dead client and the model is not auto-reloaded — recording continues, IPC writes silently land in the dead-stdin error handler, and no captions come back. Surfaced by Phase 2 final review. Phase 3 boot reorganization will lift model load + adapter binding into an `onRespawn` callback the supervisor invokes after each successful `ready` event.
- Result: **PASS** — end-to-end pipeline (renderer audio capture → main IPC → sidecar transcribe → renderer caption push) is live for Japanese audio. Phase 2 acceptance: ✅. Quality work is plan-scoped to Phase 4-5; the supervisor-restart cohesion gap is plan-scoped to Phase 3.
- Electron / model versions observed: Electron 39.8.10, whisper.cpp v1.7.6 + Metal, Kotoba-Whisper v2.0 Q5_0 GGML.
