# Background Generation (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decouple note/transcript **generation** from audio **capture** in the desktop app so a generation runs in the background while recording continues — delivering founder scenario 2 ("자막 생성 중 녹음") without the full-screen lock.

**Architecture:** Two independent lanes (spec §4). Capture lane (≤1: `current`/`recording`/`_audioWriter`) is model-free. Generation lane (≤1: a new module-scope `genJob`) runs `runGeneration({wavPath,language,kind,family})` in the background and never clears capture state. The single-generation invariant is the no-collision guarantee.

**Tech Stack:** Electron main (TS) + a single C++ sidecar (Whisper STT + Llama LLM), React renderer, vitest.

**Design ref:** [`docs/superpowers/specs/2026-06-29-concurrent-capture-background-generation-design.md`](../specs/2026-06-29-concurrent-capture-background-generation-design.md) — the §4.1 lane-by-lane mutation table is the binding contract.

## Global Constraints

- **8 GB M3, one sidecar, one model resident.** STT and LLM never co-reside. Generation is serial.
- **Recording is model-free** — capture never sends the sidecar a command; only generation does.
- **NEVER run full `pnpm verify` / `pnpm test`** (auto-backgrounds → forks spike Llama → runaway). Scoped only: `pnpm --filter @lisna/desktop exec vitest run <explicit file>` + `tsc --noEmit` + `pnpm --filter @lisna/desktop lint`. (pitfalls.md `vitest-scope`, `spike-llm`.)
- **Zombie sweep** `pgrep -fl "llama-completion|llama-cli|whisper-cli|vitest|electron-vite"` before/after any test run; never `run_in_background:true` for tests.
- **`pnpm lint` must pass** (desktop-ci gates on it; eslint catches unused vars tsc ignores).
- The lane contract: a **generation settling or crashing must never** `closeAudioWriter()` / null `current` / clear `recording` while a capture is live.

---

## File structure

| File | Responsibility in this plan |
|---|---|
| `desktop/src/main/ipc.ts` | `genJob` lane state; `runGeneration` (extracted B–F); snapshot-at-pick → free capture → background generate; de-clobbered settle; lane-aware `handleSidecarExit`/`handleSidecarGiveUp`; `isSessionInFlight`/`armIdleStop` gating; `beginGeneration`. |
| `desktop/src/main/sidecar/ipc/session-finalize.ts` | Replace the closure `finalizeInFlight` gate with `deps.beginGeneration()` / settle-clears, so the in-flight flag lives in `ipc.ts` (lifecycle-visible). |
| `desktop/src/renderer/App.tsx` | `backgroundJob` axis (sibling to `view`); unconditional progress fold; generation completion → History/notify (not `setView`); non-blocking error; demote `curatingV2`/`transcribing`. |
| `desktop/src/main/__tests__/ipc.test.ts` | FSM lane tests (settle/crash don't clobber capture; start-during-generation). |
| `desktop/src/renderer/__tests__/background-job.test.ts` (new) | Progress fold into `backgroundJob`; completion resolves off the `view` axis. |

**Internal task order (de-risk, spec §7):** main-side lane-split + lifecycle first (T1–T2), then the generation refactor (T3–T5), then renderer (T6–T8), then the queue (T9), then in-app verify (T10). T1–T2 harden the existing paths; T3–T4 flip blocking→background.

---

### Task 1: Lift the in-flight generation gate into `ipc.ts` (lifecycle-visible)

**Files:**
- Modify: `desktop/src/main/sidecar/ipc/session-finalize.ts:247-336` (remove closure `finalizeInFlight`; call `deps.beginGeneration()`)
- Modify: `desktop/src/main/ipc.ts` (add `genInFlight` module state + `beginGeneration`; pass into `registerSessionFinalize`; count it in `isSessionInFlight`)
- Test: `desktop/src/main/__tests__/ipc.test.ts`

**Interfaces:**
- Produces: `SessionFinalizeDeps.beginGeneration: () => void` — throws `FINALIZE_IN_FLIGHT` if a generation is already in flight, else marks in-flight. Cleared inside the existing `onSessionSettled` wiring in `ipc.ts`.
- Consumes: existing `registerSessionFinalize(deps)` call site (`ipc.ts:491`).

- [ ] **Step 1: Write the failing test** — re-entrancy + lifecycle visibility.

```ts
// ipc.test.ts — add to the session-finalize deps suite
it('beginGeneration: rejects a second concurrent generation', () => {
  // arrange: a deps object with the real beginGeneration from ipc state
  begin(); // genInFlight false → true
  expect(() => begin()).toThrow('FINALIZE_IN_FLIGHT');
});

it('isSessionInFlight() is true while a generation is in flight even with no capture', () => {
  // current = null, recording = false, but a generation is running
  begin();
  expect(isSessionInFlight()).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @lisna/desktop exec vitest run src/main/__tests__/ipc.test.ts -t "beginGeneration|isSessionInFlight"` → FAIL (no `beginGeneration`; `isSessionInFlight` ignores generation).

- [ ] **Step 3: Implement in `ipc.ts`** — add module state + the gate; wire it.

```ts
// ipc.ts — module scope, near the other session FSM state (~line 167)
let genInFlight = false;

// exported for index.ts wiring + tests
export function isSessionInFlight(): boolean {
  return current !== null || recording || genInFlight;   // + genInFlight
}

function beginGeneration(): void {
  if (genInFlight) throw new Error('FINALIZE_IN_FLIGHT');
  genInFlight = true;
}
```

In `registerSessionFinalize({...})` (ipc.ts:491) add `beginGeneration,` to deps. In the SAME `onSessionSettled` callback (ipc.ts:707) add `genInFlight = false;` as the FIRST line (it must clear on every settle).

- [ ] **Step 4: Rewire `session-finalize.ts`** — delete `let finalizeInFlight = false;` (:248). In all three handlers replace `if (finalizeInFlight) throw new Error('FINALIZE_IN_FLIGHT'); finalizeInFlight = true;` with `deps.beginGeneration();`, and delete the `finalizeInFlight = false;` lines in each `finally` (the settle in ipc.ts now clears it). Add `beginGeneration: () => void;` to `SessionFinalizeDeps`.

- [ ] **Step 5: Run tests** — `vitest run src/main/__tests__/ipc.test.ts` + the session-finalize tests → PASS. Then `tsc --noEmit` + `lint`.

- [ ] **Step 6: Commit** — `git commit -m "refactor(desktop): lift generation in-flight gate to ipc.ts lifecycle state"`

---

### Task 2: Lane-aware crash — `handleSidecarExit` / `handleSidecarGiveUp` must not kill a live capture

**Files:**
- Modify: `desktop/src/main/ipc.ts:992-1022` (`handleSidecarExit`), `:1045-1060` (`handleSidecarGiveUp`)
- Test: `desktop/src/main/__tests__/ipc.test.ts`

**Interfaces:**
- Consumes: `genInFlight` (Task 1), `current`/`recording`/`_audioWriter`.
- Produces: a sidecar exit during a background generation fails ONLY the generation; a live capture's writer stays open and `recording` stays true.

- [ ] **Step 1: Write the failing test** (the reviewer's blocker-1 test).

```ts
it('sidecar exit during background generation does NOT kill a live capture', () => {
  // arrange: capture live (current = orchB, recording = true, _audioWriter open)
  //          AND a generation in flight (genInFlight = true)
  startCaptureFixture();            // sets current, recording, _audioWriter
  beginGeneration();
  handleSidecarExit();
  expect(recordingGetter()).toBe(true);          // capture survives
  expect(audioWriterIsOpen()).toBe(true);        // writer NOT closed
  expect(genInFlightGetter()).toBe(false);       // generation torn down
});
```

- [ ] **Step 2: Run to verify it fails** — `vitest run src/main/__tests__/ipc.test.ts -t "does NOT kill a live capture"` → FAIL (current code closes the writer + nulls recording).

- [ ] **Step 3: Implement** — make `handleSidecarExit` lane-aware. Always invalidate generation-lane state (`_llmLoadedForCurrent = null; genInFlight = false; _activeDump = null;`). Only tear down the capture lane when **no capture is live**:

```ts
export function handleSidecarExit() {
  // generation lane: always invalidated on any sidecar exit
  _llmLoadedForCurrent = null;
  genInFlight = false;
  _activeDump = null;
  const captureLive = current !== null || recording;
  if (!captureLive) return;             // nothing else to clear
  // A capture is live. The crash belongs to the GENERATION lane (capture is
  // model-free — it never sends the sidecar a command). Do NOT close the
  // capture's writer or drop `recording`. The respawn gate (isSessionInFlight
  // true via `current`) resurrects the sidecar; capture keeps appending.
  const wasHandlerInFlight = _sessionHandlerInFlight;
  if (wasHandlerInFlight) return;       // a session/start IPC rejection handles it
  // Surface the GENERATION failure to the renderer without discarding capture.
  _safeSend?.(CHANNELS.sessionError, { message: 'GENERATION_SIDECAR_DOWN' });
}
```

(Keep the existing detailed comment block; the behavior change is: do not `closeAudioWriter()`, do not null `current`/`recording` when a capture is live. `handleSidecarGiveUp` similarly: clear generation-lane state + `_sidecarGaveUp = true`, but leave a live capture's writer open so the user keeps their audio.)

NOTE for renderer: `GENERATION_SIDECAR_DOWN` is a new code — Task 8 maps it to a non-blocking generation-failed surface, NOT the full-screen ErrorView.

- [ ] **Step 4: Run tests** → PASS. Also re-run the EXISTING `handleSidecarExit` tests (idle no-op, handler-in-flight suppression) → still green. `tsc` + `lint`.

- [ ] **Step 5: Commit** — `git commit -m "fix(desktop): lane-aware sidecar exit — generation crash preserves live capture"`

---

### Task 3: Extract `runGeneration({wavPath,language,kind,family})` from `getCurrentSession`

**Files:**
- Modify: `desktop/src/main/ipc.ts:491-602` (`getCurrentSession`) + `:631-688` (`getTranscript`)
- Test: `desktop/src/main/__tests__/ipc.test.ts` (or a new `run-generation.test.ts`)

**Interfaces:**
- Produces:
  ```ts
  interface GenSnapshot { wavPath: string; language: NoteLanguage; }
  // Runs steps (A)-(F) of the former getCurrentSession against a wavPath
  // snapshot instead of the live orchestrator. Returns the SessionContext the
  // family router consumes (note path), or the SessionTranscribeResult shape
  // (transcript path). Holds segments/dump on the genJob, not on `current`.
  async function runGenerationContext(snap: GenSnapshot): Promise<SessionContext>
  async function runTranscriptContext(snap: GenSnapshot): Promise<SessionTranscribeResult>
  ```
- Consumes: existing `transcribeWithProgress`, `loadLlmForFinalize`, `makeRecoveringSidecarFor`, `createSessionDump`, `sessionsBaseDir`.

This task is a **behavior-preserving refactor**: lift the body of `getCurrentSession` (steps A–F, ipc.ts:499-601) and `getTranscript` (A–D, :640-687) into the two free functions above, parameterized by `snap.wavPath`/`snap.language` instead of `orch.wavPath`/`orch.language`. The segments cache (`orch.exposedSegments`/`setFinalizeSegments`) moves onto a module-scope `let genSegments: TranscriptSegment[] = []` held by the generation lane (reset per generation). `getCurrentSession`/`getTranscript` become thin adapters that build a `GenSnapshot` from the live `current` and delegate — so EXISTING finalize/transcribe tests stay green.

- [ ] **Step 1: Characterization test first** — assert the existing live finalize still works through the refactor (run the existing ipc finalize test; it must stay green). Add one new test: `runGenerationContext({wavPath: fixtureWav, language:'ja'})` returns a context with non-empty `segments` and `current === null`.

- [ ] **Step 2: Run** — existing finalize test green now (baseline). New test FAILs (no `runGenerationContext`).

- [ ] **Step 3: Implement the extraction** — move A–F into `runGenerationContext`/`runTranscriptContext`; replace `orch.exposedSegments`/`orch.setFinalizeSegments`/`orch.wavPath`/`orch.language` with `genSegments`/`snap.wavPath`/`snap.language`. `getCurrentSession`/`getTranscript` build `{wavPath: orch.wavPath, language: orch.language}` and call the new functions. Keep the `WAV_MISSING`/`EMPTY_RECORDING`/`SIDECAR_DOWN` guards keyed on `genSegments`/`snap.wavPath`.

- [ ] **Step 4: Run** — existing + new tests PASS; `tsc` + `lint`.

- [ ] **Step 5: Commit** — `git commit -m "refactor(desktop): extract runGeneration from getCurrentSession (wavPath snapshot)"`

---

### Task 4: Snapshot-at-pick → free capture → background generate; de-clobber settle

**Files:**
- Modify: `desktop/src/main/ipc.ts` (the finalize/transcribe deps; `onSessionSettled`)
- Test: `desktop/src/main/__tests__/ipc.test.ts`

**Interfaces:**
- Consumes: `runGenerationContext`/`runTranscriptContext` (Task 3), `genInFlight` (Task 1).
- Produces: at pick time the capture lane is freed (`current = null`, `closeAudioWriter()`) and the snapshot drives generation; the generation **settle clears ONLY generation-lane state**.

- [ ] **Step 1: Write the failing test** (reviewer blocker-2).

```ts
it('generation settle does NOT close a concurrently-started capture writer', () => {
  // a generation is in flight from a PRIOR recording's snapshot;
  // meanwhile a NEW capture started (current = orchB, recording = true, writerB open)
  beginGenerationFromSnapshot(snapA);
  startCaptureFixture();                 // orchB live, writerB open
  settleGeneration({ ok: true, family: 'meeting', note });
  expect(audioWriterIsOpen()).toBe(true);   // writerB untouched
  expect(recordingGetter()).toBe(true);     // capture survives
  expect(currentIsOrchB()).toBe(true);
});
```

- [ ] **Step 2: Run → FAIL** (today `onSessionSettled` success path runs `closeAudioWriter()` + `current=null` + `recording=false`).

- [ ] **Step 3: Implement** — two edits:
  1. In `getCurrentSession`/`getTranscript` adapters (Task 3): the moment the snapshot is built (pick time), set `genInFlight` is already handled by `beginGeneration`; the **capture free** happens where the renderer triggers the pick. Add a `snapshotAndFreeCapture()` helper used at the start of the live note/transcript path: capture `{wavPath: current.wavPath, language: current.language}`, then `closeAudioWriter(); current = null; recording = false;` (the stopped recording's capture is done — its WAV is on disk). The generation then runs from the snapshot.
  2. **De-clobber `onSessionSettled`** (ipc.ts:707-733): remove `closeAudioWriter()`, `current = null`, `recording = false` from it. Keep ONLY: `genInFlight = false`, the `_activeDump` writeResult+clear, `unloadLlmIdle()` + `_llmLoadedForCurrent = null`, `genSegments = []`, `armIdleStop()`. (The capture was already freed at pick time; settle is now generation-only.)

```ts
// onSessionSettled — generation-lane ONLY now
onSessionSettled: (result) => {
  genInFlight = false;
  if ('family' in result) _activeDump?.writeResult(result);
  _activeDump = null;
  unloadLlmIdle();
  _llmLoadedForCurrent = null;
  genSegments = [];
  armIdleStop();        // re-arms only if BOTH lanes idle (isSessionInFlight)
  // NOTE: NO closeAudioWriter / current / recording here — capture lane is
  // independent (freed at pick time; a NEW capture may be live).
},
```

- [ ] **Step 4: Run** — new test + existing finalize/transcribe/discard tests PASS. Verify the existing "session/start rejects SESSION_ACTIVE while recording" test still holds (capture-lane reject unchanged) and add: "session/start succeeds while genInFlight (no capture)". `tsc` + `lint`.

- [ ] **Step 5: Commit** — `git commit -m "feat(desktop): background generation — snapshot+free capture at pick, generation-only settle"`

---

### Task 5: Reconcile `getDumpSession` re-entrancy guard with the lane model

**Files:**
- Modify: `desktop/src/main/ipc.ts:605-624` (`getDumpSession` `isLiveSessionActive`), `desktop/src/main/dump-finalize-context.ts:38`
- Test: `desktop/src/main/__tests__/dump-finalize-context.test.ts`

**Interfaces:**
- Produces: a History regen is rejected while a generation is in flight (`genInFlight`), NOT merely while a capture is live. A live capture must NOT block a regen; two generations must still be rejected.

- [ ] **Step 1: Write the failing test** — `buildDumpSessionContext` with `isLiveSessionActive` reflecting `genInFlight`: regen allowed while a capture is live (genInFlight=false); rejected while genInFlight=true.

- [ ] **Step 2: Run → FAIL** (today gates on `current||recording`).

- [ ] **Step 3: Implement** — change the `getDumpSession` wiring to pass `isLiveSessionActive: () => genInFlight` (the real invariant is "no second generation"), and update the `dump-finalize-context.ts` guard comment. `beginGeneration()` already enforces the single-slot at the handler; this aligns the dump path's own guard.

- [ ] **Step 4: Run → PASS**; `tsc` + `lint`.

- [ ] **Step 5: Commit** — `git commit -m "fix(desktop): dump-regen re-entrancy keys on genInFlight not live capture"`

---

### Task 6: Renderer — `backgroundJob` axis + unconditional progress fold + chip

**Files:**
- Modify: `desktop/src/renderer/App.tsx` (`AuthenticatedApp` state + `onFinalizeProgress` effect + render)
- Test: `desktop/src/renderer/__tests__/background-job.test.ts` (new), reuse the pure-reducer pattern from `finalize-progress-apply.test.ts`

**Interfaces:**
- Produces: `backgroundJob: { kind: 'note'|'transcript'; progress: ProgressState | null; status: 'running'|'done'|'error'; dumpId?: string; message?: string } | null` in `AuthenticatedApp`, sibling to `view`. A pure reducer `applyBackgroundProgress(prev, msg)` (exported, tested) folds `FinalizeProgressPayload` into it.

- [ ] **Step 1: Write the failing test** — `applyBackgroundProgress` folds `transcribe-start`/`attempt-start`/`finalize-done` exactly like the current `applyFinalizeProgress` but onto the `backgroundJob` shape; and a fold while the foreground `view` is `recording` is NOT dropped.

- [ ] **Step 2: Run → FAIL** (no `applyBackgroundProgress`; current `applyFinalizeProgress` is gated on `view.kind`).

- [ ] **Step 3: Implement** — add `backgroundJob` state; move the `onFinalizeProgress` effect to fold into `backgroundJob` UNCONDITIONALLY (remove the `prev.kind === 'curatingV2'` gate). Render a small `<GenerationChip job={backgroundJob} onOpen={...} onDismiss={...}/>` overlaid regardless of `view` (so it shows on the recording screen).

- [ ] **Step 4: Run → PASS**; `tsc` + `lint`.

- [ ] **Step 5: Commit** — `git commit -m "feat(desktop): renderer backgroundJob axis + progress chip"`

---

### Task 7: Renderer — generation completion resolves off the `view` axis; recording stays foreground

**Files:**
- Modify: `desktop/src/renderer/App.tsx` (`runFinalize`/`runTranscribe`; FamilyPicker `onPick`; remove `curatingV2`/`transcribing` View variants)
- Test: `desktop/src/renderer/__tests__/background-job.test.ts`

**Interfaces:**
- Consumes: `backgroundJob` (Task 6).
- Produces: picking note/transcript sets `backgroundJob={status:'running'}` and RETURNS the foreground to `recording` (not a full-screen progress view); completion sets `backgroundJob.status='done'` + `dumpId` (result reachable via History); it does NOT `setView({kind:'note'})`.

- [ ] **Step 1: Write the failing test** — after `onPick('meeting')` the `view` is `recording` (not `curatingV2`) and `backgroundJob.status==='running'`; on resolve, `backgroundJob.status==='done'` and `view` is still `recording`.

- [ ] **Step 2: Run → FAIL** (today `onPick` setView curatingV2; runFinalize setView note).

- [ ] **Step 3: Implement** — `onPick` sets `backgroundJob` running + `setView({kind:'recording'})`; `runFinalize`/`runTranscribe` resolve into `setBackgroundJob({status:'done', dumpId, kind})` (the dump is already written by main); remove `curatingV2`/`transcribing` from the `View` union + `renderView` (their progress is now the chip). The "done" chip offers "보기" → `setView({kind:'history', id: dumpId})` or `{kind:'note', note}` if the note is returned.

- [ ] **Step 4: Run → PASS**; `tsc` + `lint`.

- [ ] **Step 5: Commit** — `git commit -m "feat(desktop): generation completes into backgroundJob+History, recording stays foreground"`

---

### Task 8: Renderer — non-blocking generation-error surface

**Files:**
- Modify: `desktop/src/renderer/App.tsx` (`runFinalize`/`runTranscribe` catch; `onSessionError` for `GENERATION_SIDECAR_DOWN`)
- Test: `desktop/src/renderer/__tests__/background-job.test.ts`

**Interfaces:**
- Consumes: `backgroundJob`, the new `GENERATION_SIDECAR_DOWN` code (Task 2).
- Produces: a generation failure sets `backgroundJob.status='error'` + `message` (chip shows "生成失敗 — 再試行"), NOT a full-screen ErrorView; retry routes to the job's History dump (the snapshot is on disk), never `familyPicking` (which assumed the live `current` is the failed session).

- [ ] **Step 1: Write the failing test** — a rejected `runFinalize` sets `backgroundJob.status==='error'` and leaves `view==='recording'`; `GENERATION_SIDECAR_DOWN` via `onSessionError` does the same (does NOT transition to the full-screen error view).

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — `runFinalize`/`runTranscribe` catch → `setBackgroundJob({status:'error', message})`. In `onSessionError`, branch: `GENERATION_SIDECAR_DOWN` → background-job error; everything else (capture/sidecar give-up) → the existing full-screen `ErrorView` path (capture failures still block, correctly). Chip "再試行" → History regen of the dump.

- [ ] **Step 4: Run → PASS**; `tsc` + `lint`.

- [ ] **Step 5: Commit** — `git commit -m "feat(desktop): non-blocking generation-error surface; capture errors still block"`

---

### Task 9: Depth-1 generation queue (safety net)

**Files:**
- Modify: `desktop/src/main/ipc.ts` (`beginGeneration` → a 1-slot queue) OR keep the throw + renderer-gate
- Test: `desktop/src/main/__tests__/ipc.test.ts`

**Interfaces:**
- Produces: a 2nd generation requested while one runs is queued (depth 1) and runs on settle, instead of throwing `FINALIZE_IN_FLIGHT`. Founder says it won't happen; this is the safety net (spec §5.1).

- [ ] **Step 1: Write the failing test** — two `beginGeneration` calls: the 2nd does not throw; after the 1st settles, the queued one is dispatched.

- [ ] **Step 2: Run → FAIL** (today the 2nd throws).

- [ ] **Step 3: Implement** — minimal: a `pendingGen: (() => void) | null`; `beginGeneration` enqueues if busy (depth 1; a 3rd still throws `FINALIZE_QUEUE_FULL`). Settle drains. **ponytail:** if this proves fiddly, KEEP the throw + a renderer guard (button disabled while `backgroundJob.status==='running'`) and DELETE this task — founder confirmed concurrent generation won't happen. Decide during impl; do not gold-plate.

- [ ] **Step 4: Run → PASS**; `tsc` + `lint`.

- [ ] **Step 5: Commit** — `git commit -m "feat(desktop): depth-1 generation queue"` (or skip per ponytail note).

---

### Task 10: In-app verification (founder loop checkpoint)

**Files:** none (build + manual)

- [ ] **Step 1:** Scoped suite green — `tsc --noEmit` + `lint` + `vitest run` over the touched test files only. Zombie sweep.
- [ ] **Step 2:** Build + install the app (lisna-sidecar-rebuild not needed — no C++ change; electron-builder `--mac dir`, signed; quit any running instance first — `ditto` over a launching app corrupts codesign, verify `codesign --verify --deep --strict`). Bump version (artifact-version-bump).
- [ ] **Step 3:** Founder tries **scenario 2**: record → stop → pick note → while it generates (chip shows progress), start a NEW recording → confirm the new recording captures fine and the note lands in History when done. Also: regenerate a History note while recording.
- [ ] **Step 4:** Capture feedback → loop (fixes / Phase 2 slice plan).

---

## Self-review notes

- **Spec coverage:** §4.1 lane table → T1/T2/T4; §4.2 runGeneration → T3/T4; §4.4 renderer → T6/T7/T8; §4.5 lifecycle+crash → T1/T2/T5; §5 guarantees 1–6 → T1(g1), T4(g2), T4(g3), T2(g5), T3/T4(g6); §7 phasing → task order. Slice (§4.3, guarantee 4) is **Phase 2**, not this plan.
- **Type consistency:** `genInFlight`, `genJob`/`genSegments`, `beginGeneration`, `runGenerationContext`/`runTranscriptContext`, `GENERATION_SIDECAR_DOWN`, `applyBackgroundProgress`, `backgroundJob` — used consistently across tasks.
- **Open (founder, Phase 2):** quick-transcript UX, done-notification surface, slice↔note linkage (spec §9).
