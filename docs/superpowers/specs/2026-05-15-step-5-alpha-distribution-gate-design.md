# Step 5 — Alpha Distribution Gate Design

**Status**: Spec stub (post-Step-4 reviewer findings)
**Date**: 2026-05-15
**Owner**: TBD (founder + AI)
**Parent**: `2026-05-13-task-3.5-step-4-ui-integration-design.md`

---

## 1. Problem

After Step 4 (Task 3.5 Step 4) PR #6 merges, the code is technically correct but **not distributable to alpha testers**. Two reviewer reports (concurrency critic + ship-readiness skeptic, both 2026-05-15) surfaced ~15 alpha-blocking gaps that fall outside Step 4's UI-integration scope. This spec catalogs those gaps with explicit owners and a sequenced execution order.

This is a **gating** spec: nothing in here is optional for alpha distribution. Items deferred to v2.1+ are filed in §9 separately. If alpha is sent without resolving §3-§7 below, founder/users see preventable UX failures within the first 60 seconds.

---

## 2. Scope and non-scope

### In scope (Step 5)
- Items that block a non-developer alpha tester from completing **one happy-path session** (Start → record → Stop → see Note).
- Items that block remote diagnosis of a failed alpha session.
- Items that block macOS distribution (Gatekeeper, model bundle).

### Out of scope (later v2.x)
- Telemetry to external services (Sentry/PostHog) — local logfile only for alpha.
- Renderer-side component unit tests.
- Multi-language settings UI.
- Persisted Note history.
- `RecordingOrchestrator` rename, react-markdown, structured `session/error` codes, etc. — Step 4 §9 deferred list stays deferred.

---

## 3. Critical UX gaps (founder/alpha would hit within minutes)

### 3.1 LLM system prompt: plain-text-friendly output
**Owner**: founder (prompt-engineering decisions)
**Why**: `defaultPrompt` (`orchestrator.ts:13-16`) literally tells the LLM "Output Markdown." NoteView renders via `<pre>` (`NoteView.tsx:25`). Result: raw `# Header`/`**bold**` chars visible to user. Reviewer R2 finding E.
**Tasks**:
1. Founder validates current `defaultPrompt` on a real JA recording (requires Task 6, see below).
2. Founder rewrites `defaultPrompt` to emit plain-text-with-structure (numbered lists, indentation; no markdown syntax tokens).
3. Add 2-3 LLM-as-judge eval-set anchors against the new prompt (use the v2.1 JA eval-set process from parent spec §9 Risk 7 — partial anchor is OK for alpha gate).
4. Commit the new prompt + sample golden Note in `desktop/docs/manual-verification.md`.

### 3.2 ErrorView friendly message map
**Owner**: founder (copy decisions) + AI (implementation)
**Why**: ErrorView (`ErrorView.tsx:23`) shows `err.message` verbatim. Errors thrown are `MODELS_NOT_CONFIGURED`, `SIDECAR_DOWN`, `NO_ACTIVE_SESSION`, `SESSION_NOT_READY`, `APP_QUIT`, `UNSUPPORTED_LANGUAGE`, `EMPTY_TRANSCRIPT` (and now any sidecar error). Reviewer R2 finding B + corollary of M1.
**Tasks**:
1. Founder writes 1-2 sentence JA + EN copy for each of the 7+ codes.
2. AI implements `errorMessageMap.ts` in `desktop/src/renderer/` and wires into `ErrorView`.
3. Default fallback for unknown codes: "Something went wrong. Please try again." (don't show raw error to user).

### 3.3 "Loading model…" progress indication
**Owner**: AI
**Why**: STT cold load is 3-10s; with TCC prompt stacked, total can be 30-40s. `Recording.tsx:147-149` toggles button label but no spinner/animation. Reviewer R2 finding C.
**Tasks**:
1. Add a spinner element next to "Loading model…" button label (or replace label with a progress component).
2. After 8s without resolution, append "(taking longer than usual…)" subtext.
3. `session/start` IPC handler emits `session/phase` `'stt-loading'` immediately (already does — but renderer ignores it, see §3.4).

### 3.4 FinalizingView phase visibility (min-display-time)
**Owner**: AI
**Why**: `stt-unloading` phase is <1s. User can't read it before it flips. Reviewer R2 finding D.
**Tasks**:
1. Add `minDisplayMs: 1500` to FinalizingView — track phase entry time, defer next-phase render until min elapsed.
2. Alternative: collapse `stt-unloading` and `llm-loading` into a single "Switching models…" label since they're back-to-back transitions.

### 3.5 Operation timeouts (`Promise.race`)
**Owner**: AI
**Why**: `generate()` has no timeout. If sidecar wedges, FinalizingView is forever. Reviewer R1 + R2 (both flag). Worst-case Stop latency is currently unbounded.
**Tasks**:
1. Wrap `stt.loadModel` and `stt.unloadModel` with 5s `Promise.race` timeout → throw `STT_TIMEOUT`.
2. Wrap `llm.loadModel` and `llm.unloadModel` with 10s timeout → throw `LLM_LOAD_TIMEOUT`.
3. Wrap `llm.generate` for-await loop with 60s no-progress timeout (Phase 3's `SidecarClient.sendStream` already has per-token progress timeout; just expose it via constructor).
4. Add corresponding error codes to ErrorView map (§3.2).

### 3.6 Permanent give-up recovery
**Owner**: AI
**Why**: After 2 consecutive sidecar crashes, supervisor gives up. Try Again hits `SIDECAR_DOWN` forever. ErrorView copy lies. Reviewer R2 finding F.
**Tasks**:
1. Distinguish transient vs give-up state in ipc.ts: when `supervisor.onCrash` fires (give-up only), set a module flag.
2. Renderer's ErrorView shows different copy when give-up flag is true: "The recording engine could not recover. Please restart the app." Hide Try Again button; show Restart Lisna button instead.
3. Restart button calls `app.relaunch(); app.quit()` via new `lifecycle/restart` IPC.

---

## 4. Observability (remote-debug minimum)

### 4.1 File logger (`electron-log`)
**Owner**: AI
**Why**: All current logs go to stdout. In packaged Electron build with no DevTools, no log file exists. Remote debugging impossible. Reviewer R2 §2.
**Tasks**:
1. Add `electron-log` dependency. Configure to write `~/Library/Logs/Lisna/main.log` (rotating, max 5MB × 5 files).
2. Replace `console.error/log` in ipc.ts, supervisor.ts, main/index.ts with `log.error/info`.
3. Document log location in alpha onboarding (§5.3).

### 4.2 Session breadcrumbs
**Owner**: AI
**Why**: "Why was Stop laggy?" needs answer in log. Currently silent.
**Tasks**:
1. Log session boundaries: `[session] start lang=ja`, `[session] stop note=NNN chars segments=NN`, `[session] error code=X`.
2. Log phase timings: `[session] phase stt-unload=NNNms`, `phase llm-load=NNNms`, `phase generate=NNNms tokens=NNN`.
3. Log adapter respawn events.

### 4.3 No telemetry (opt-in only, post-alpha)
**Decision**: do NOT add Sentry/PostHog/analytics for v2.0 alpha. Privacy-by-default is part of the v2 concept lock. File logger only. If founder wants telemetry post-alpha, separate opt-in spec.

---

## 5. Distribution gate (macOS packaging)

### 5.1 Model packaging or first-run download
**Owner**: founder (license/CDN decisions) + AI (implementation)
**Why**: `LISNA_DEV_STT_MODEL` / `LISNA_DEV_LLM_MODEL` env vars are dev-only. Finder-launched app has no env → `MODELS_NOT_CONFIGURED` on first click. Reviewer R2 finding A.
**Tasks**:
1. Founder decides: bundle GGUF in .dmg (~3GB, license check) vs first-run download (~3GB CDN, license + bandwidth + tier-1 progress UI).
2. AI implements first-run model resolver:
   - On `app.whenReady`, check `app.getPath('userData')/models/` for expected GGUF filenames.
   - If missing: render a "First-run setup" view in renderer instead of `<Recording/>`. Show download progress (or "Drop GGUF here" picker).
   - On complete, register model paths to `registerIpc` deps and transition to Recording view.
3. Spec lives in `2026-05-15-step-5-task-X-model-resolver-design.md` (follow-up sub-spec).

### 5.2 Code signing + notarization (Phase 0.5 reactivate)
**Owner**: founder (Apple Developer Program enrollment) + AI (implementation)
**Why**: Without notarization, alpha users get "unidentified developer" Gatekeeper warning on first launch. Phase 0.5 was deferred per memory entry `v2_phase05_deferred_2026-05-13.md` until "alpha distribution to someone other than founder." That moment is now.
**Tasks**:
1. Founder enrolls in Apple Developer Program ($99/yr).
2. AI re-activates Phase 0.5 tasks from `2026-05-12-v2-on-device-implementation.md` lines 595-770 (the existing plan).
3. CI integration: `electron-builder --mac` with codesign + notarytool.
4. Verify with a 2nd Mac (not the build machine) — drag-install, double-click, no Gatekeeper warning.

### 5.3 Alpha onboarding doc
**Owner**: founder + AI
**Why**: Even with bundled models, alpha testers need a 1-page README: download link, first-launch expectations (mic permission, ~10s model load), how to report bugs (zip the log file from `~/Library/Logs/Lisna/`).
**Tasks**:
1. Write `desktop/docs/alpha-onboarding.md` in JA + EN.
2. Distribute via the alpha channel (decided by founder — Discord? private GitHub? signed DMG email?).

---

## 6. Manual smoke test (Task H.2 from Step 4)

**Owner**: founder (provides real GGUF + records JA audio)
**Why**: Step 4's Task H.2 was skipped. End-to-end Start → Stop → Note has never run on a real model. Reviewer R2 finding §3.
**Tasks** (sequenced before §3.1 prompt work):
1. Founder provides paths to `ggml-large-v3.bin` (or v3-q5; ~1-3GB) and `Llama-3.2-3B-Instruct-Q4_K_M.gguf` (or similar; ~2GB).
2. Set env vars, run `pnpm dev`.
3. Execute 5 scenarios from Step 4 plan Task H.2 (happy / error / try-again / quit-mid-finalize / empty-transcript-after-M1).
4. Record output (including raw LLM markdown for §3.1) in `desktop/docs/manual-verification.md`.
5. **Blockers** that surface here are alpha-prerequisites — fix or escalate.

---

## 7. Sequencing

```
Step 5 phase order (each phase blocks the next):

  A. Manual smoke (§6)              ──┐  unblocks everything downstream;
                                       │  surfaces real prompt output quality
                                       ▼
  B. Prompt tuning (§3.1)           ──┐  needs smoke output to validate
                                       │
                                       ▼
  C. Operation timeouts (§3.5)      ──┐  hardens against hangs before
     + permanent give-up (§3.6)        │  exposing to alpha users
                                       ▼
  D. Loading + finalizing UX        ──┐  user-visible polish
     (§3.3 + §3.4)                     │
                                       ▼
  E. ErrorView i18n (§3.2)          ──┐  needs decisions from §3.6 codes
                                       │
                                       ▼
  F. File logger (§4.1 + §4.2)      ──┐  enables remote debug from day 1
                                       │
                                       ▼
  G. Model packaging (§5.1)         ──┐  founder decision + AI work
                                       │
                                       ▼
  H. Codesign + notarize (§5.2)     ──┐  Apple Developer enrollment
                                       │
                                       ▼
  I. Onboarding doc (§5.3)           Alpha ready
```

A and G can parallelize partially (founder works on model paths while AI works on smoke flow). B-F are all AI work; can sequence behind A.

Estimated calendar: A: ~1 day. B-F: ~3-4 days. G-I: depends on founder timeline (Apple Developer enrollment is ~1 day, GGUF licensing/CDN is the unknown).

---

## 8. What we are NOT doing in Step 5

- ❌ Renderer-side React component unit tests (Step 4 §9 deferred; let alpha tell us what breaks)
- ❌ Telemetry to external services (privacy-first, file logger only)
- ❌ Multi-language settings UI (concept lock = JA-only for v2.0)
- ❌ Note history / persistence (separate v2.1 feature)
- ❌ `session/cancel` IPC (audio-first ordering eliminates the need)
- ❌ react-router (4 views fits conditional render)
- ❌ `RecordingOrchestrator` → `AudioCaptureOrchestrator` rename (cleanup PR later)
- ❌ Token streaming UX (Q6-C deferred at brainstorming time, still deferred)
- ❌ Structured `session/error` code split (transient vs give-up) — flat string OK for v2.0 alpha; §3.2 friendly-map handles it

---

## 9. Open decisions (for founder)

These block Step 5 progress; founder input needed before AI can proceed:

1. **§5.1 Model packaging**: bundle vs first-run download? (license check + CDN cost vs DMG bloat)
2. **§3.1 Prompt rewrite**: target output format spec? (numbered list? markdown-flavored? specific JA register?)
3. **§3.2 ErrorView copy**: JA-only or JA+EN? Tone (formal-keigo or polite-da/desu)?
4. **§5.3 Alpha channel**: Discord? private GitHub repo? email + DMG?
5. **§6 Manual smoke**: when can founder provide real GGUF files + 2-min JA recording for end-to-end?

---

## 10. Risks not yet addressed (Step 6+ candidates)

Items the Step 5 scope intentionally leaves open. Track here so they don't become invisible debt:

- **Long-session memory growth** (Step 4 §9). M1 8GB users running 1hr+ sessions may OOM during finalize. No Step 5 task; revisit when user reports.
- **Sidecar respawn adapter freshness in production** (Reviewer R1 I5). Adapter-per-session pattern works structurally but the integration path through real `SidecarSupervisor.start` after a crash has no test. Add to post-alpha test pass.
- **`safeSend` window-recreate gap** (Step 4 §9). `window-all-closed → app.quit()` policy makes the race almost impossible, but if Step 5 §3.6 adds a restart button, the gap reopens.
- **`buildPrompt?` injection seam unused** (Reviewer R2 §4.6). Fig-leaf override. Either remove or actually use in §3.1.
- **`Note.transcriptSegments` shared array reference** (R1 I3 + R2 §3). Defensive copy: 1-line fix at orchestrator.ts:80 (`transcriptSegments: [...this.segments]`). Defer until first reuse-related bug.

---

**Next action**: founder reviews §9 (open decisions), Step 5 brainstorming session opens with answers in hand. AI proceeds with §6 manual smoke as soon as GGUF paths are provided.
