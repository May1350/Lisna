# Concurrent capture + background generation — design

**Date**: 2026-06-29
**Status**: DRAFT v2 (revised after independent 3-lens review — see §11)
**Branch**: `feat/v2-background-generation`
**Author**: Claude (controller session) + founder direction

---

## 1. Problem

Today the desktop app is a **single-session, blocking** machine. Stop →
FamilyPicker → finalize (`curatingV2` / `transcribing`) takes over the whole
UI, and main-side state (`current`, `recording`, `_audioWriter`,
`_llmLoadedForCurrent`, `_activeDump`) is global to one session. While a note
or transcript is being generated, the user can do nothing else — they cannot
start a new recording, and an existing recording cannot keep running.

Founder request (2026-06-29), narrowed through brainstorming to exactly two
scenarios that must work:

1. **녹음 중 자막 생성** — while a (long) recording is still capturing, produce
   an immediate transcript of a short span, *without stopping the long one*.
2. **자막 생성 중 녹음** — while a note/transcript is generating, start (or
   continue) a recording.

Hard founder constraints, confirmed:

- The two recordings in scenario 1 share the **same audio source**. Not two
  different devices.
- **Generation never overlaps another generation** ("자막 만들기는 동시에 돌
  일이 없어"). At most one note/transcript generates at a time.
- "워크플로우는 겹치거나 하지 않게" — the workflows must not collide.

## 2. Constraints that shape the design

- **8 GB M3, one sidecar, one model resident at a time.** STT (~0.5 GB) and
  LLM (~2–3 GB) cannot co-reside; a finalize loads STT (transcribe) → unloads →
  loads LLM (note). Generation is inherently serial.
- **Recording is model-free.** Capture = renderer audio → IPC `recording/chunk`
  → `handleChunk` → `orch.onChunk` → `onAudioChunk` → `WavWriter.append`. The
  sidecar/models are **not touched during recording** (verified:
  `ipc.ts:466-479`, `orchestrator.ts` onChunk → onAudioChunk only). So capture
  and generation never contend on the sidecar; an LLM (~3 GB) generation + a
  live capture (~0 model RAM) fits 8 GB (the app already sustains the 3 GB
  finalize).
- **The WAV is crash-safe and readable while being written** (`WavWriter`
  `fdatasync`s a valid 44-byte-header PCM16 file after every append —
  `audio-wav-writer.ts:31-47`). Any already-elapsed byte span can be read off
  disk mid-recording (via a **separate read-only fd** — the writer's fd is
  write-only, position-managed).

## 3. Decision: slice + background generation (Approach A)

Because the short and long recordings share the **same source**, the short
recording's audio is a **sub-span of the long recording's WAV**. So:

- **One active capture at a time.** A "quick transcript" is a *slice* of the
  ongoing recording's WAV, not a second capture.
- **Generation runs as a single background job**, decoupled from the capture.

There is never more than one live capture, and never more than one generation —
exactly the founder's envelope. No session-id-on-chunk, no capture registry, no
tee, no priority queue.

### Rejected alternative — two independent captures (tee)

Required only for **different**-source simultaneous capture (system meeting +
mic memo). Founder scoped to same-source → **out of scope**; revisit only if a
different-source need emerges from real use.

## 4. Architecture — two independent lanes

```
CAPTURE LANE (≤1 active)              GENERATION LANE (≤1 active, background)
─────────────────────────            ──────────────────────────────────────
renderer audio capture               GenerationJob = { wavPath, language,
  → PCM chunks → recording/chunk        kind:'note'|'transcript', family?,
  → main: WavWriter.append              segments?, dump?, llmLoaded, inFlight }
  (NO sidecar / NO model)            runGeneration(job): STT(wav) [→ LLM(note)]
                                       → write dump/result → notify renderer
```

### 4.1 Main-side state, split by lane (the load-bearing change)

The review confirmed the headline diagnosis: `onSessionSettled` today does
`current=null; recording=false; closeAudioWriter()` on **success**
(`ipc.ts:707-733`), and `handleSidecarExit` clears the same on **crash**
(`ipc.ts:992-1022`). A background generation hitting either path while a new
recording is live would **kill the live recording** (close its writer fd, drop
`recording`). The fix is not abstract — **every mutation in those three
functions must be assigned to a lane.** Enumerated:

| Mutation (current location) | Belongs to lane |
|---|---|
| `current = null` / `recording = false` (settle `ipc.ts:730-731`; exit `:1013-1014`; give-up `:1048-1050`) | **CAPTURE** — only a capture stop/discard/crash clears these |
| `closeAudioWriter()` (settle `:719`; exit `:1012`; give-up `:1047`) | **CAPTURE** — only the capture owns `_audioWriter` |
| `_activeDump` write/clear (settle `:713-714`) | **GENERATION** — moves onto `GenerationJob.dump` |
| `unloadLlmIdle()` + `_llmLoadedForCurrent = null` (settle `:724-725`; exit `:1009`) | **GENERATION** — moves onto `GenerationJob.llmLoaded` |
| `armIdleStop()` (settle `:727,732`; start `cancelIdleStop`) | **SHARED** — re-armed when BOTH lanes idle (§4.5) |
| `safeSend(sessionError…)` (exit `:1021`; give-up `:1056`) | depends — see §4.5 lane-aware crash |

Concrete state after the split:

- **Capture lane** (still ≤1): `current` (orchestrator), `recording`,
  `_audioWriter`. Cleared ONLY by capture stop/discard or a crash attributed to
  capture. A generation settling or crashing must not touch these.
- **Generation lane** (≤1): a module-scope `genJob: GenerationJob | null`. The
  `inFlight`/`segments`/`dump`/`llmLoaded` that today live as the closure var
  `finalizeInFlight` (`session-finalize.ts:248`), `_activeDump` (`ipc.ts:160`),
  and `_llmLoadedForCurrent` (`ipc.ts:145`) move onto `genJob`. **The
  invalidation sites that today null `_llmLoadedForCurrent` in
  `handleSidecarExit` (`:1009`) and `onSessionSettled` (`:725`) must follow the
  field onto `genJob`, or the P0-2/P0-3 cache-honesty invariants silently
  break.**

### 4.2 Background generation is NEW code, not a from-dump reuse

The review falsified the v1 spec's central reuse claim. The from-dump path
(`buildDumpSessionContext` → `loadDumpTranscript`,
`dump-finalize-context.ts:43`) reads an **existing `transcript.json`** and runs
**no STT**; `transcript.json` is written only inside `getCurrentSession`
(`ipc.ts:557`) / `getTranscript` (`:669`) **after** the step-B whole-WAV
transcription. A just-stopped recording (and any fresh slice) has **no
transcript.json**. So a `{wavPath, language}` snapshot cannot feed the from-dump
path — it has no segments.

Therefore Phase 1 introduces a real new entrypoint:

```
runGeneration(job: GenerationJob): Promise<Result>
  // extracted from getCurrentSession steps (B)-(F), parameterized by job:
  (B) transcribeWithProgress(client, sttPath, job.language, job.wavPath)
      → job.segments        // STT whole-WAV; held on genJob, NOT on `current`
  (C) empty guard (job.segments.length === 0 → EMPTY_RECORDING)
  (D) write dump transcript (onto job.dump)
  (E) loadLlmForFinalize (only when job.kind === 'note')
  (F) makeRecoveringSidecarFor → generate note (kind === 'note' only)
      // kind === 'transcript' STOPS after (D), returns segments (the
      //   getTranscript shape)
```

This is the existing `getCurrentSession` body lifted out of the live-orchestrator
closure into a free function keyed on `{wavPath, language}`. The
`WAV_MISSING`/`EMPTY_RECORDING` guards key off `job.segments`/`job.wavPath`
instead of `orch.exposedSegments`/`orch.wavPath`. The from-dump path
(`getDumpSession`) stays as-is for **History regeneration** (already-transcribed
items).

At Stop+pick (or slice-stop): build `genJob = { wavPath, language, kind,
family }`, **free the capture lane immediately** (`current = null`,
`closeAudioWriter()` for the stopped recording), set `genJob.inFlight = true`,
and run `runGeneration(genJob)` without awaiting on the UI thread.

### 4.3 Quick transcript (slice)

Recording screen gains a **빠른 자막** control: start-span records a start
timestamp on the ongoing capture; stop-span → main slices the live WAV
`[startSec, endSec)` into a temp WAV and enqueues a **transcript** generation
with that temp WAV as `genJob.wavPath`. The long recording is untouched.

Slice mechanics (verified against `WavWriter`):
- Open a **separate read-only fd** (`fs.openSync(wavPath, 'r')`) — the writer's
  fd is write-only/pwrite-managed.
- Byte range `[44 + floor(startSec*16000)*2, 44 + floor(endSec*16000)*2)`
  (16 kHz mono PCM16 → 32000 B/s, sample-aligned).
- **Clamp `endByte` to the live `dataBytes`** at slice time. `WavWriter` must
  expose a `get dataBytes()` accessor (currently private, `:18`) so the slice
  never reads past the synchronously-known write cursor.
- Wrap the bytes in a fresh 44-byte header → temp WAV → `genJob`.

### 4.4 Renderer rework (NOT an additive state)

The review confirmed `App.tsx` is a single mutually-exclusive `view` FSM:
`curatingV2`/`transcribing` ARE top-level views (`App.tsx:348-355`),
`onFinalizeProgress` folds into `view` only when `prev.kind` is those two
(`:165-177`), and `runFinalize`/`runTranscribe` end with `setView(terminal)`
(`:482,504,524`). Delivering scenario 2 is a structural change:

1. **Add a sibling `backgroundJob: { kind, progress, status } | null`** in
   `AuthenticatedApp`, independent of `view`. The recording screen renders with
   a small **"生成中… N%"** chip when `backgroundJob` is non-null.
2. **Move the `onFinalizeProgress` reducer to fold into `backgroundJob`
   unconditionally** (not gated on `view.kind`), so progress lands while the
   foreground is `recording`.
3. **`runGeneration` completion resolves into `backgroundJob` + History**, NOT
   `setView`. Done → mark `backgroundJob.status='done'` + a lightweight notify
   + the result is in History; it does NOT replace the current screen.
4. **Error edge re-point**: a background-job failure shows a non-blocking error
   surface (toast/banner), NOT the full-screen `ErrorView`. The current
   `retryViewFor → familyPicking` edge assumed the live `current` is the failed
   session — but `current` may now be a DIFFERENT recording, so retry must route
   to the job's History dump, not `familyPicking`.
5. `curatingV2`/`transcribing` as full-screen `View` variants are **removed**
   (their progress now renders as the chip). The FamilyPicker still chooses
   note vs transcript; picking just enqueues a background job and returns to
   recording.

### 4.5 Sidecar lifecycle + crash, lane-aware

- **`isSessionInFlight()` (`ipc.ts:194`) and `armIdleStop` (`:184`)** count
  **capture-active OR `genJob.inFlight`**. Requires lifting the in-flight flag
  out of the `session-finalize.ts` closure (`:248`) to module scope (onto
  `genJob`). Today `finalizeInFlight` is unreachable from `isSessionInFlight`.
- **`handleSidecarExit` must be lane-aware** (review blocker #1). A generation
  crash (the expected 8 GB failure) must fail ONLY `genJob` and surface a
  background-job error — it must NOT `closeAudioWriter()` / null
  `current`/`recording` when a capture is live. Because capture is model-free,
  the crash never actually broke capture; only the lane-blind cleanup did. The
  respawn gate then resurrects the sidecar (a capture is in flight). When NO
  capture is live, behavior is unchanged.
- **`handleSidecarGiveUp`** similarly tears down only the lane(s) actually
  affected; a permanent give-up with a live capture stops the generation but
  lets the capture finish writing its WAV (the user can still get their audio).
- **`getDumpSession` re-entrancy**: it gates on `isLiveSessionActive: () =>
  current !== null || recording` and throws `SESSION_ACTIVE`
  (`dump-finalize-context.ts:38`). Under "free capture at Stop" + background
  generation, the guard that prevented two generations racing the single
  sidecar must be reconciled: the real invariant is **"reject a new generation
  while `genJob.inFlight`"**, not "while a capture is live." Re-point the guard
  to `genJob.inFlight` (a capture being live must NOT block a History regen, and
  two generations must still be rejected/queued).

## 5. Collision / correctness guarantees (mechanism-level)

1. **Generation × generation** — single `genJob` slot; a 2nd request while
   `genJob.inFlight` is gated in the renderer and **queued depth-1** in main
   (NEW: today `session-finalize.ts:253` just throws `FINALIZE_IN_FLIGHT`; the
   depth-1 queue replaces the throw). Founder: won't happen; the queue is the
   safety net.
2. **Generation settle × live capture** — settle clears only `genJob`
   state; `closeAudioWriter()`/`current`/`recording` are removed from the
   generation-settle path (§4.1 table). Test: live capture + generation
   completes → `_audioWriter` still open, `recording` still true.
3. **New capture start × in-flight generation** — `session/start` rejects only
   on `current !== null` (active capture), NOT on `genJob.inFlight`.
4. **Slice read × concurrent WAV append** — slice reads `endByte ≤ dataBytes`
   (already-elapsed + fdatasync'd) via its own read-only fd; never past the
   write cursor (§4.3).
5. **Sidecar crash mid-generation × live capture** — lane-aware
   `handleSidecarExit` fails only `genJob`; capture's WAV survives, `recording`
   stays true (§4.5). Test: capture live + generation in flight + sidecar exit
   → chunks keep appending; generation surfaces failure independently.
6. **STT/LLM × capture memory** — capture is model-free; STT (~0.5 GB) or LLM
   (~3 GB) + live capture fits 8 GB (the app already sustains 3 GB finalize).

## 6. Out of scope (YAGNI)

Tee / different-source concurrent capture; two concurrent generations; priority
queue beyond depth-1; pause/resume of the long recording; linking a slice
transcript to the long recording's note in History.

## 7. Phasing (build → try → feedback loop)

- **Phase 1 — Background generation + non-blocking UI.** State split (§4.1),
  `runGeneration` extraction (§4.2), renderer rework (§4.4), lane-aware
  lifecycle/crash (§4.5), guarantees 1–3, 5, 6. Delivers **scenario 2**.
  *Implementation order (de-risk):* (1a) build the lane-split + renderer
  `backgroundJob` infra against the EXISTING no-`current` from-dump path first
  (History regen-while-recording — real reuse, proves the concurrency model
  with zero new STT code), then (1b) add the `runGeneration({wavPath,language})`
  fresh-recording path. This sequences the smallest real-reuse slice first.
- **Phase 2 — Quick-transcript slice.** §4.3 + guarantee 4 + the `WavWriter`
  `dataBytes` accessor. Delivers **scenario 1**. Depends on Phase 1's
  `runGeneration`.

## 8. Testing

- **Unit/logic (vitest, scoped — never full `pnpm verify`, spike-llm rule):**
  - State-split FSM: generation settle does NOT close the capture's
    `_audioWriter` and does NOT clear `current`/`recording`; `session/start`
    allowed while `genJob.inFlight`; depth-1 queue.
  - **Lane-aware crash:** live capture + `genJob.inFlight` + `handleSidecarExit`
    → `_audioWriter` stays open, `recording` stays true, `handleChunk` keeps
    appending; generation surfaces failure.
  - WAV byte-slice: fixture WAV, slice `[a,b)` → correct sample count +
    decodable + never reads past `dataBytes`; own read-only fd.
  - `runGeneration` runs from a `{wavPath,language}` snapshot with
    `current === null`.
- **Mocked-pipeline:** background generation completes with no live `current`;
  a concurrent `session/start` succeeds mid-generation.
- **In-app (founder loop):** the two scenarios end-to-end on the installed
  `/Applications/Lisna.app`. Zombie-swept; foreground only.

## 9. Open questions for founder

- Quick-transcript UX: start/stop span (spec assumption, matches "짧은 녹음")
  vs. a single "직전 N분 자막" button.
- Done-notification surface: History badge + light toast (spec assumption) vs.
  auto-open the result.
- Slice transcript and the long recording's note: independent History entries
  (spec assumption, §6) vs. linked.

## 10. Key files (implementation map)

- `desktop/src/main/ipc.ts` — state split (§4.1), `runGeneration` extraction
  (§4.2), lane-aware `handleSidecarExit`/`handleSidecarGiveUp`/`onSessionSettled`
  (§4.5), `isSessionInFlight`/`armIdleStop` gating, slice handler (§4.3).
- `desktop/src/main/sidecar/ipc/session-finalize.ts` — lift `finalizeInFlight`
  to module scope (`genJob`); depth-1 queue replacing the throw.
- `desktop/src/main/audio-wav-writer.ts` — `get dataBytes()` accessor (§4.3).
- `desktop/src/main/dump-finalize-context.ts` — re-point the `SESSION_ACTIVE`
  re-entrancy guard to `genJob.inFlight` (§4.5).
- `desktop/src/renderer/App.tsx` — `backgroundJob` axis, unconditional progress
  fold, completion → History/notify, error re-point, demote
  `curatingV2`/`transcribing` (§4.4).
- `desktop/src/renderer/routes/Recording.tsx` — 生成中 chip + 빠른 자막 control.
- IPC additions: `session/transcribe-span` (slice); generation
  start/complete/error events repurposed for the background-job feed.

## 11. Review history

- **2026-06-29 — independent 3-lens adversarial review** (race/clobber,
  resource/lifecycle [died on a connection error mid-run; its domain — lifecycle
  gating, `finalizeInFlight` scope, 8 GB fit — is covered by the other two's
  findings], scenario-completeness). Verdict **risky → strategy sound, two
  blockers + concerns**. This v2 incorporates: lane-by-lane mutation
  enumeration (§4.1), `runGeneration` as new code not a from-dump reuse (§4.2),
  renderer rework honesty (§4.4), lane-aware crash + re-entrancy reconciliation
  (§4.5), `dataBytes` accessor + own-fd slice (§4.3), depth-1 queue is new (§5).
