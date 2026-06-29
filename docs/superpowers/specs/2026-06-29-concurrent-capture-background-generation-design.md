# Concurrent capture + background generation — design

**Date**: 2026-06-29
**Status**: DRAFT (brainstorming → spec; pending independent review + founder sign-off)
**Branch**: `feat/v2-background-generation`
**Author**: Claude (controller session) + founder direction

---

## 1. Problem

Today the desktop app is a **single-session, blocking** machine. Stop →
FamilyPicker → finalize (`curatingV2` / `transcribing`) takes over the whole
UI, and main-side state (`current`, `recording`, `_audioWriter`,
`_llmLoadedForCurrent`, `_activeDump`) is global to one session. While a note
or transcript is being generated, the user can do nothing else — they cannot
start a new recording, and they cannot keep an existing recording running.

Founder request (2026-06-29), narrowed through brainstorming to exactly two
scenarios that must work:

1. **녹음 중 자막 생성** — while a (long) recording is still capturing, produce
   an immediate transcript of a short span, *without stopping the long one*.
2. **자막 생성 중 녹음** — while a note/transcript is generating, start (or
   continue) a recording.

Hard founder constraints, confirmed:

- The two recordings in scenario 1 share the **same audio source** (e.g. both
  system audio). They are not two different devices.
- **Generation never overlaps another generation** ("자막 만들기는 동시에 돌
  일이 없어"). At most one note/transcript is generated at a time.
- "워크플로우는 겹치거나 하지 않게" — the workflows must not collide.

## 2. Constraints that shape the design

- **8 GB M3, one sidecar, one model resident at a time.** STT (~0.5 GB) and
  LLM (~2–3 GB) cannot co-reside; a finalize loads STT (transcribe) → unloads →
  loads LLM (note). This is why generation is inherently serial. (`ipc.ts`
  comments: "the 8 GB floor forbids STT+LLM co-resident".)
- **Recording is model-free.** Post-STT-Phase-2a, recording = renderer audio
  capture (getUserMedia/getDisplayMedia → AudioContext worklet → PCM chunks) →
  IPC `recording/chunk` → main writes to a WAV via `WavWriter`. `orch.start()`
  is a state-reset no-op; `handleChunk` only drives `onAudioChunk` → WAV. **The
  sidecar/models are NOT touched during recording** — only at finalize.
  Therefore capture and generation never contend on the sidecar.
- **The WAV is crash-safe and readable while being written.** `WavWriter`
  `fdatasync`s a valid 44-byte-header PCM16 file after every append, so any
  already-elapsed byte span can be read off disk mid-recording.

## 3. Decision: slice + background generation (Approach A)

Because the short and long recordings share the **same source**, the short
recording's audio is literally a **sub-span of the long recording's WAV**.
Capturing it a second time (a "tee" or a second OS capture stream) would write
identical bytes twice and add device-contention risk. So:

- **One active capture at a time.** A "quick transcript" is a *slice* of the
  ongoing recording's WAV, not a second capture.
- **Generation runs as a single background job**, decoupled from the capture.

With this, **there is never more than one live capture**, and **never more
than one generation** — which is exactly the founder's stated envelope. No
session-id-on-chunk, no capture registry, no tee, no priority queue.

### Rejected alternative — two independent captures (tee)

Genuinely concurrent capture (each recording owns a stream, or one stream
tee'd to N WAVs, chunks tagged with a session id). Required only if recordings
could ever use **different** sources simultaneously (system meeting + separate
mic memo). Founder explicitly scoped to same-source, so this is **out of
scope** — revisit only if a different-source need emerges from real use.

## 4. Architecture — two independent lanes

```
CAPTURE LANE (≤1 active)              GENERATION LANE (≤1 active, background)
─────────────────────────            ──────────────────────────────────────
renderer audio capture               snapshot { wavPath, language, kind,
  → PCM chunks → recording/chunk        family? } taken at Stop/quick-stop
  → main: WavWriter.append           → sidecar: STT (transcribe) [→ LLM (note)]
  (NO sidecar / NO model)            → write dump/result
                                     → notify renderer (done / error)
```

The lanes share only the sidecar **process**, and capture never sends it
commands. The single-generation invariant is the collision guarantee.

### 4.1 Main-side state split (the load-bearing change)

Today all session state is global and the **finalize settle clears it**
(`onSessionSettled`: `current = null; recording = false`). If a background
generation did that while a *new* recording was live, it would **kill the new
recording**. So we split state by lane:

- **Capture state** (unchanged shape, still ≤1): `current` (orchestrator),
  `recording`, `_audioWriter`. Owned by the active recording. Cleared only by
  capture-lane events (stop/discard/crash), **never by a generation settling.**
- **Generation state** (new, ≤1): a `GenerationJob` holding a self-contained
  snapshot — `{ wavPath, language, kind: 'note'|'transcript', family?, dump,
  llmLoaded }` — plus an `inFlight` flag. `_activeDump` and
  `_llmLoadedForCurrent` move under this. A generation reads its snapshot's
  `wavPath` off disk; it does **not** dereference `current`.

At "Stop + pick" (or "quick-transcript stop"): take the snapshot (the WAV is
already on disk), **free the capture lane immediately** so a new recording can
start, and enqueue the generation. The generation's settle touches only
`GenerationJob` state.

### 4.2 Generation runs from a snapshot, not from `current`

The existing **from-dump** finalize path (`getDumpSession` /
`buildDumpSessionContext`) already generates from an on-disk transcript/WAV
with no live `current`. The background generation generalizes this: every
generation (live note, transcript, slice) runs from a `{wavPath, language}`
snapshot via the same self-contained path. `getCurrentSession`'s coupling to
the live orchestrator is removed in favor of "snapshot at stop."

### 4.3 Quick transcript (slice)

Recording screen gains a **빠른 자막** control: start-span → records a start
timestamp on the ongoing capture; stop-span → main slices the live WAV
`[startSec, endSec)` into a temp WAV (byte range `44 + floor(sec*16000)*2`,
wrapped in a fresh 44-byte header) and enqueues a **transcript** generation
with that temp WAV as its snapshot. The long recording is untouched. The slice
transcript lands in History like any other transcript.

### 4.4 Renderer — non-blocking

- `curatingV2` / `transcribing` stop being **full-screen blocking views**.
- `AuthenticatedApp` gains a parallel `backgroundJob: { kind, progress } | null`
  state, independent of `view`. The recording screen renders with a small
  **"生成中… N%"** chip (driven by the existing `onFinalizeProgress` feed);
  on done → result available in History + a lightweight notify; on error → a
  non-blocking error surface (not a full-screen takeover) that routes retry to
  History (the snapshot is on disk).
- Starting/continuing a recording is never gated on an in-flight generation.

### 4.5 Sidecar lifecycle reconciliation

- `isSessionInFlight()` (respawn gate) and the idle-stop timer must treat
  **capture-active OR generation-in-flight** as "in use" (today: `current ||
  recording`). A generation must keep the sidecar alive; an active capture must
  not let idle-stop kill a sidecar a generation still needs.
- `handleSidecarExit` / `handleSidecarGiveUp`: clear BOTH lanes' state and fail
  the in-flight generation; an active capture loses its sidecar but recording
  is model-free, so the capture's WAV is intact — surface the generation
  failure without discarding the capture if one is live.

## 5. Collision / correctness guarantees (review targets)

Enumerated because "겹치지 않게" is the whole point:

1. **Generation × generation** — single `inFlight` slot; a 2nd request while
   busy is gated in the renderer (control disabled) and defended in main with a
   depth-1 queue (founder: won't happen; the queue is the safety net).
2. **Generation settle × live capture** — settle clears only `GenerationJob`
   state; `current`/`recording`/`_audioWriter` untouched. (Fixes the clobber.)
3. **New capture start × in-flight generation** — `session/start` no longer
   rejects on a generation being in flight; it only rejects on an active
   **capture** (`current !== null`). Generation in-flight ≠ capture active.
4. **Slice read × concurrent WAV append** — slice reads a byte range whose
   `endByte ≤ current dataBytes` (the span already elapsed + fdatasync'd);
   never reads past the write cursor.
5. **Sidecar crash mid-generation × live capture** — generation fails loudly;
   capture's WAV survives (model-free); lifecycle gate keeps respawn correct.
6. **STT-for-slice load × ongoing capture** — STT load is in the sidecar
   process; capture is renderer→WAV; no interference; ~0.5 GB STT + capture fits
   8 GB. A **note** (LLM ~3 GB) generating while a capture runs also fits (the
   app already runs the 3 GB finalize; capture adds ~0).

## 6. Out of scope (YAGNI)

- Tee / two simultaneous captures / different-source concurrent capture.
- Two concurrent generations; priority queue beyond depth-1.
- Pause/resume of the long recording.
- Cross-session merging of a slice transcript into the long recording's note.

## 7. Phasing (for the build → try → feedback loop)

- **Phase 1 — Background generation + non-blocking UI.** State split (§4.1),
  snapshot-based generation (§4.2), non-blocking renderer (§4.4), lifecycle
  gate (§4.5), guarantees 1–3,5. Delivers **scenario 2** ("자막 생성 중 녹음")
  and removes the full-screen lock. Usable/feedback-able on its own.
- **Phase 2 — Quick-transcript slice.** §4.3 + guarantee 4. Delivers
  **scenario 1** ("녹음 중 자막 생성").

## 8. Testing

- **Unit/logic (vitest, scoped — never full `pnpm verify`, spike-llm rule):**
  state-split FSM (settle does not clear capture; start allowed during
  generation; depth-1 queue); WAV byte-slice math (a fixture WAV, slice
  `[a,b)`, assert sample count + decodability + that it never reads past
  `dataBytes`); snapshot independence from `current`.
- **Mocked-pipeline:** generation runs from a snapshot with `current === null`.
- **In-app (founder loop):** the two scenarios end-to-end on the installed
  `/Applications/Lisna.app`. Zombie-swept; foreground only.

## 9. Open questions for review / founder

- Quick-transcript UX: start/stop span vs. a single "직전 N분 자막" button.
  (Spec assumes start/stop span — matches "짧은 녹음" mental model.)
- Done-notification surface: History badge only, vs. a toast, vs. auto-open the
  result. (Spec assumes History + light notify; recording stays foreground.)
- Should a slice transcript and the long recording's eventual note be linked in
  History, or fully independent entries? (Spec: independent — §6.)
