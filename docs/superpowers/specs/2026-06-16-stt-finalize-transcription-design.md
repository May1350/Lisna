# STT Phase 2 — Record-then-Transcribe (finalize-time whole-file STT)

**Date:** 2026-06-16
**Status:** Design — engineering-hardened after independent expert review (2026-06-16);
one privacy-posture item flagged for founder ratification (section 13).
**Track:** STT accuracy (v2 on-device desktop app, `desktop/`)
**Supersedes the framing in:** `v2_next_steps_stt_and_cleanup_2026-06-15` memory
("re-transcribe saved WAV at finalize, keep live captions"). The founder
upgraded the direction in the 2026-06-16 brainstorm: **drop live captions
entirely** — record only, transcribe once at finalize.
**Builds on (merged):** PR #132 (`f415237`) — large-v3-turbo default STT +
Whisper `initial_prompt` glossary mechanism + audio-save hook + `transcribe-wav.ts`.

> Verified by review (do not re-litigate): the accuracy claim (10s-chunk
> isolation, not the model, causes the errors; one whole-file `whisper_full`
> pass fixes it via cross-window text conditioning) is correct; the `pwrite`/
> `this.pos` crash-safe-header reasoning is correct; the P0-3 retry-preservation
> and the 8GB load ordering are correct.

---

## 1. Problem

Live transcription quality is the user-visible gate ("처참"), and the worst
offenders are **proper nouns**. The root cause is **not** the model's
vocabulary — it is the **10-second chunking**.

During a recording the app cuts audio into ~10s chunks and transcribes each one
**in isolation** (`orchestrator.ts:653-662` → `stt.transcribe(chunk)`). Whisper
sees no surrounding context, so it cannot disambiguate homophones and domain
terms. A single `whisper_full` call over the whole file conditions each decode
window on the previously-decoded text (`prompt_past`, whisper.cpp ~7581-7592) —
that running context is exactly what the per-chunk path throws away (separate
calls, `no_context` defaulted on between them).

**Founder evidence (real 10-min 会計 podcast, 2026-06-15):** same audio, two passes:

| Pass | Proper nouns |
|---|---|
| Live (10s chunks) | 起用価値 ✗ · Hashflow ✗ · 海峡 ✗ · 会談 ✗ · ファイナス ✗ · サダキ ✗ |
| Whole-file (turbo) | 企業価値 ✓ · 田中千一 ✓ · 佐々木 ✓ · 会計 ✓ · ファイナンス ✓ — **0 wrong forms** |

The accuracy win is therefore **already empirically proven**. This spec is the
architecture to deliver it and the trade-offs it carries.

---

## 2. The decision (what changes)

**Stop doing live transcription. Record only. Transcribe once, accurately, at finalize.**

```
Recording phase   audio capture → stream ALL samples to one WAV on disk   (no STT model loaded)
                  renderer shows: level meter + elapsed time

Stop → finalize   load STT (with session language) → transcribe the whole WAV
                  (one whisper_full, glossary initial_prompt, language-filtered)
                  → unload STT → load LLM → generate structured note
                  → keep the WAV on disk
```

Live captions, per-chunk STT, the renderer silence gate, dual transcript
accumulation, and STT-at-start all go away. The note pipeline (silence-aware
chunking → grammar LLM → all 4 families) is **unchanged** — it just receives a
more accurate transcript.

### 2.1 Founder decisions locked (2026-06-16 brainstorm)

1. **No live captions.** During recording the screen shows a **level meter +
   elapsed time + "녹음 중" state** — proof the mic is capturing, without showing
   wrong text. (Confirmed against PRD: "live audio → structured notes" means
   *live audio input*, not *live caption display*; the deliverable is the note,
   generated at finalize. No PRD violation.)
2. **Audio retention = keep + manual delete.** The session WAV is **always saved**
   (no longer opt-in) and **retained after finalize**. The user can delete
   recordings manually. The WAV becomes the single durable source of truth and a
   crash safety net. *Accompanying disclosure/consent posture: section 13 (founder
   ratification).*
3. **Latency policy = always transcribe + show progress.** Every recording, any
   length. Finalize shows "오디오 받아쓰는 중… → 노트 작성 중…". Founder accepted
   "쪼개서 하니 길어도 시간만 더면 OK". (Decision-2 option C — "quick note first,
   upgrade in background" — is deferred; with no live transcript there is nothing
   to seed a quick note from.)

### 2.2 Why this beats the prior "keep live + re-transcribe" framing
- **No double work** — record-only transcribes once (the prior plan did it live
  *and* again at finalize). Same finalize wait; all live STT compute removed.
- **Memory / heat / battery** — no STT model (~1.5 GB RSS) resident during
  recording. Big win on 8 GB M1.
- **Removes the bad first impression** — no wrong captions streaming live.
- **Faster start** — start no longer blocks on the 60s STT cold-load
  (`orchestrator.ts:634-638`); only the macOS mic-permission (TCC) prompt, which
  is `getUserMedia` at capture start, remains. Model + sidecar readiness move to
  finalize.

---

## 3. Goals / non-goals

### Goals
- Final note (all 4 families) built from a whole-file, context-conditioned
  transcript → proper-noun errors → 0 on the reference recording, without a glossary.
- Recording is lightweight: no model resident, crash-safe + gap-faithful audio capture.
- Finalize latency is honest and visible (real progress for both transcription
  and note phases — no fabricated progress).
- The saved WAV is a durable, decodable-at-all-times, full-timeline artifact the
  user controls.

### Non-goals (this spec)
- **History viewer** (#113/F2, unimplemented). Only the integration point is
  noted: kept WAVs enable a future "re-transcribe / regenerate from History".
- **Diarization** (parked; `.claude/worktrees/diarization-der-spike`). Design is
  diarization-agnostic; when it resumes it runs on the finalize transcript
  (single-speaker collapse stays, per `session-finalize.ts:159-163`).
- **LLM 2nd-pass text correction** (deferred — fabrication risk, per memory).
- **Unfinalized-recording auto-recovery UI** — phase 2d (section 12), deferrable;
  the crash-safe WAV that enables it is in scope.

---

## 4. Architecture

Two cleanly separated phases. Model lifecycle never overlaps (8 GB floor).

### 4.1 Recording phase (no model loaded)

| Concern | Today | New |
|---|---|---|
| STT model | loaded at `orch.start()` (`orchestrator.ts:629-639`) | **not loaded** |
| Per-chunk audio | `onChunk` → `stt.transcribe` → accumulate segments | `onChunk` → **append to WAV only** |
| Silence | renderer `emitChunk` **drops silent chunks** before `sender()` (`renderer/audio/orchestrator.ts:94-100`) | **silence gate removed** — every chunk streamed to main |
| WAV capture | gated OFF (`ipc.ts:554-563`) | **always on** |
| WAV durability | header patched on `close()` only (`audio-wav-writer.ts:46`) | **header refreshed each append + `fdatasync`** (crash-safe) |
| WAV fidelity | n/a (gated) | **gap-faithful** — silence written, so duration == wall-clock |
| Renderer | live-caption list + "N segments" (`Recording.tsx:247,255-266`) | **level meter + elapsed time** |
| Start latency | blocks on STT cold-load | mic-init + TCC only (fast) |

**Critical (blocker fix):** the renderer's silence gate
(`renderer/audio/orchestrator.ts:94-100`) exists only to save per-chunk STT cost.
With live STT gone it has no purpose, and if left in place it would make the WAV
**silence-compressed** — a 60-min recording with 20 min of quiet becomes a 40-min
WAV, so whisper's absolute timestamps no longer match wall-clock, `durationSec` is
wrong, and crash recovery loses time. **Remove the gate: stream every chunk
(silent included) from the ungated `onSamples` path to main, which appends it
verbatim.** Acceptance test: WAV duration == elapsed recording time across silent
gaps (section 10).

The **level meter is computed renderer-locally** (RMS/peak of the captured audio)
— no IPC round-trip, no STT (section 5.2).

### 4.2 Finalize phase (the new transcription step)

The live path (`getCurrentSession`, `ipc.ts:334-400`) gains a transcription step.
**The from-dump regen path is explicitly NOT touched** (it has a saved transcript
and no WAV — section 5.6.3). New live-finalize order:

```
1. Resolve the session WAV path from the orchestrator (a named `wavPath` field).
2. Load STT (turbo) WITH the session language (language is a LOAD-time param —
   whisper-cpp-stt.ts:13-21, ipc.ts:523).
3. Transcribe the WHOLE WAV in one conditioned pass (transcribeFile, section 5.3):
   glossary initial_prompt + filterSegments(language) parity → TranscriptSegment[]
   with ABSOLUTE timestamps (one call → no re-anchoring).
4. Store the result as ORCHESTRATOR-INSTANCE DATA (section 5.6.1) so `exposedSegments`
   reflects it AND a note-gen retry reuses it (transcribe once).
5. Write the debug dump transcript.json AFTER transcription (now the accurate
   transcript); on STT failure write an error record instead (section 5.6.2).
6. Unload STT (existing mach-confirmed RSS drop, `orchestrator.ts:612-614`) → load LLM.
7. adaptToV2Transcript(segments) → existing chunking → grammar LLM → note.
8. Keep the WAV (do not delete).
```

Steps 2-3 are new; today STT is unloaded-as-no-op at finalize because it was
loaded at start. The transcription runs **while STT is loaded and before LLM load**,
so the two models never coexist.

**Empty-recording guard (blocker fix).** Today the EMPTY_TRANSCRIPT guard lives
only in `orchestrator.stop()` (`ipc.ts:673-738`), which the **v2 finalize path
never calls**. And the renderer FSM (`App.tsx:240`) discards a session on zero
*live* segments — under record-only there are always zero live segments, so it
would discard **every** recording. Fixes:
- Move the empty-recording guard to the IPC finalize path, keyed on
  **transcribeFile returning zero segments** (not on live segment count).
- Re-source the renderer's empty/too-short detection from **WAV bytes / elapsed
  time**, not segment count (`App.tsx:240`).

**Retry (P0-3, `ipc.ts:457-460`).** On note-gen failure the orchestrator is
preserved. Because the transcription is cached as orchestrator data (step 4) — NOT
keyed on `_llmLoadedForCurrent`, which is nulled in 5 places (set at `ipc.ts:377`;
nulled in `handleSidecarExit`, `onSessionSettled` ~456, the recovery path ~284,
and discard) — a retry **reuses** the transcript and re-runs only note generation.

---

## 5. Detailed design

### 5.1 Always-on, crash-safe, gap-faithful audio capture
- **Remove the gate.** `ipc.ts:554-578` opens the `WavWriter` only when
  `LISNA_SAVE_AUDIO=1` or `save-audio.on` exists. The WAV is now **mandatory** (no
  audio → no note), so the writer always opens at session start. Update the PII-off
  comments (`ipc.ts:148-151,554-563`) to the new always-on posture. Keep an env
  kill-switch only for tests/debug.
- **Remove the renderer silence gate** (section 4.1) so the WAV is gap-faithful.
- **Crash-safe header.** After writing samples, `WavWriter.append()`
  (`audio-wav-writer.ts:31-41`) also rewrites the 44-byte header with the current
  `dataBytes` at offset 0: `fs.writeSync(fd, header(this.dataBytes), 0, 44, 0)`.
  This is a `pwrite` at position 0 and does **not** disturb the append cursor
  (`this.pos`) — verified. Result: the file is a valid, decodable WAV at all times
  (minus at most the last partial chunk).
- **Durability.** `fs.writeSync` is not `fsync` — buffered writes can be lost on a
  hard power loss. Add an `fdatasync` after each append (or on a short interval) so
  the on-disk WAV is recoverable. (If `fdatasync` per-append proves too costly,
  downgrade the crash-safety claim explicitly; do not silently leave it.)
- **Disk-full / write error.** The current `onAudioChunk` callback swallows errors
  (`ipc.ts:572` `try{…}catch{}`). Because the WAV is now the sole source, a write
  failure (disk full) MUST **surface** (stop recording with a clear error), not be
  silently swallowed.
- **wavPath.** The path is currently a local in the gate block (`ipc.ts:569`).
  Promote it to a field on the orchestrator/session so finalize (section 4.2 step 1)
  can resolve it.
- **Storage / format.** `<userData>/audio-captures/<ISO-timestamp>.wav`, 16 kHz mono
  PCM16 (unchanged from #132).

### 5.2 Recording UI — level meter
- Replace the live-caption block (`Recording.tsx:255-266`) and the "· N segments"
  counter (`:247`) with a **level meter** + the existing elapsed timer (`:246`) + a
  clear "녹음 중" indicator.
- **Meter spec:** driven by the renderer-local **ungated** captured stream
  (`renderer/audio` capturer `onSamples`); dBFS scale ~−60..0; peak-with-decay
  ballistics; a clip indicator at 0 dBFS; a silence indicator when below the floor;
  `aria-live`/role for accessibility; show the capture device name. (RMS computed
  locally — no chunk round-trip.)
- **Remove the dead live-caption surface:** `CHANNELS.onChunk` send
  (`ipc.ts:309-313`), `ChunkResultPayload`, preload `onChunk` (`preload/index.ts:37-41`),
  App.tsx `onChunk` subscription + accumulation, and `View.segments` (~5 sites).
  `handleChunk` (`ipc.ts:299-321`) stops returning segments. **Note:** the WAV
  append is NOT in `handleChunk` — it is in `orchestrator.onChunk` via
  `opts.onAudioChunk` (`orchestrator.ts:654` → callback set at `ipc.ts:572`); that
  path stays, the `stt.transcribe` call inside `onChunk` (`orchestrator.ts:655`) is
  removed.
- This is a **dense work surface**, so it stays function-first (per `web-design.md`
  scope-boundary rule) — no legal-pad decoration.

### 5.3 Finalize transcription primitive — `transcribeFile`
The existing per-chunk `WhisperCppSTT.transcribe` is unsuited for whole-file:
- it **base64-encodes the whole Float32 buffer into one NDJSON message**
  (`whisper-cpp-stt.ts:31-32`) — a 60-min recording is ~230 MB of float32 → ~307 MB
  base64 in a single line; unacceptable;
- it has a **fixed 120s timeout** (`:40`) — far too short for a long file;
- it would otherwise be fine, but a path-based primitive avoids both.

**Primitive — path-based `transcribeFile`:**
- New sidecar request `{ type: 'transcribeFile', path, sampleRate, initialPrompt?, language }`
  and a **streamed response** (`sendStream`): progress events, then a final
  segments payload. The C++ sidecar **reads the WAV from disk** (it already reads
  model files from paths) and runs `whisper_full` on the full buffer in **one
  conditioned pass** — exactly reproducing the founder's proven whole-file result.
  *(The streamed/progress response shape is a real protocol addition, not a
  placeholder — define it concretely in the plan.)*
- **No base64 over IPC. Timeout is progress-based** (no-progress window), mirroring
  the LLM generate guard — not a fixed wall-clock cap.
- **Cancel/abort:** `whisper_full` aborts only via `whisper_full_params.abort_callback`
  (whisper.h ~574) — wire it as the cancel path.
- **Progress:** `whisper_full_params.progress_callback` emits "% of audio decoded"
  → the finalize progress UI (section 5.5).
- **filterSegments parity (correctness):** the per-chunk path applies the
  language-specific Layer-E blocklist (`whisper-cpp-stt.ts:44-45`). `transcribeFile`
  MUST apply the **same** `filterSegments(language)` — otherwise the whole-file path
  silently skips filtering. Add a parity test (section 10).
- **Language is a LOAD-time param.** Load STT with the session language
  (`ipc.ts:523`) before `transcribeFile`.
- **STT-stall recovery (do NOT reuse `makeRecoveringSidecarFor`).** That wrapper's
  `recover()` reloads the **LLM** (`ipc.ts:277-279`) — calling it while STT is the
  loaded model would violate the 8 GB floor (STT + LLM). Add a **dedicated STT-stall
  recovery**: restart the sidecar, reload **STT with the session language**, re-issue
  `transcribeFile` once.
- TS surface: a `transcribeFile(path, { initialPrompt, language })` method on the
  STT engine.

**Alternative (long-recording fallback) — TS-windowed:** read the WAV in TS and
feed `transcribe` in large overlapping windows. Lower risk (no C++ rebuild) but
loses cross-window conditioning at seams. See section 5.4 for when it applies and
the conditioning caveat. **Decision: path-based `transcribeFile` is the target.**
The TS-windowed approach is only the memory guard for very long recordings (5.4)
or a deliberate first-cut choice that owns no C++ change.

### 5.4 Memory guard for long recordings (measure first)
Peak finalize RSS = STT model (~1.5 GB) + audio buffer + Whisper mel/KV (LLM not
loaded yet). A 2-hour file is ~230 MB PCM (~460 MB as float).

- **Measure first (section 9).** Do not pre-build windowing. Single whole-file pass
  is the default; introduce windowing **only if** the measured peak RSS breaches the
  section-9 ceiling.
- **If windowing is needed:** large windows with overlap. The conditioning caveat is
  real and was overstated in the prior draft: across separate `whisper_full` calls
  `no_context` defaults true (whisper.h ~620), **clearing `prompt_past`** — so seams
  lose *text* conditioning unless we **carry the previous window's tail text forward
  as `prompt_tokens`**. Dedupe overlapping segments by **timestamp anchor** (not text)
  to avoid double-counting. Concrete starting default (tune from the RSS curve): window
  when recording > 90 min, ~6-min windows, ~15s overlap, tail-text carried as prompt.
- **Fail-first seam fixture** (section 10): a recording crossing a window seam must
  not drop or duplicate words.

### 5.5 Finalize progress UI
Decision 3 (always transcribe + show progress). Extend the existing finalize
progress UI (#122, `curatingV2`) with a **transcription phase before** the note phase:
- Phase A "오디오 받아쓰는 중…": **real** progress from the Whisper `progress_callback`
  (% of audio). **Do not** show a fabricated/estimated bar — that breaks the
  no-fake-progress constraint (2026-06-13). If real progress is unavailable in the
  first cut, show a spinner + elapsed timer, not a fake percentage.
- Phase B "노트 작성 중…": the existing chunk/attempt/elapsed display.
- Add a `sessionLog.phase('stt-transcribe-finalize', ms)` breadcrumb (mirrors
  `stt-unload-finalize`/`llm-load-finalize`, `ipc.ts:252,255`).

### 5.6 Transcript ownership + note integration

#### 5.6.1 Where the transcription lives
The whole-file pass returns `TranscriptSegment[]` (`{startSec, endSec, text,
noSpeechProb?}`) with absolute timestamps. Store it on a **named orchestrator
field** (e.g. `finalizeSegments`) that `exposedSegments` (read at `ipc.ts:359,389`)
reflects, so the existing read sites and the P0-3 retry-reuse work unchanged.
`noSpeechProb` is now **whole-file-scoped** (one `whisper_full` call), not per-10s-chunk.

#### 5.6.2 Dump ordering
Today transcript.json is written **before** any model load (`ipc.ts:355-360`) so a
load failure still leaves the transcript on disk. Under record-only there is no
transcript until transcribeFile runs, so: write transcript.json **after**
transcribeFile; on STT failure write an **error record** (preserve the
"diagnosable-on-disk" property the dump exists for, `ipc.ts:340-345`).

#### 5.6.3 From-dump regen is untouched
`loadLlmForFinalize` (`ipc.ts:244-256`) is shared by the live path **and** the
from-dump regen path (`dump-finalize-context.ts:59`). The from-dump path has a saved
transcript and **no WAV** — it must NOT transcribe. So: add a **separate
live-finalize prep** (load-STT → transcribeFile → unload-STT → load-LLM) used only
by `getCurrentSession`; keep `loadLlmForFinalize` as-is for from-dump;
`buildDumpSessionContext` never transcribes.

#### 5.6.4 Downstream unchanged
`segments` (now from transcription) → `adaptToV2Transcript` (`session-finalize.ts:176`)
→ `chunkTranscript` (silence-aware) → per-family `finalize*` → grammar LLM → note.
Family routing, diarization-disabled collapse, provenance, and the 4 renderers are
untouched.

The glossary `initial_prompt` (reuse `loadGlossaryInitialPrompt()`, `ipc.ts:229-237`)
is applied to the finalize transcription. **Caveat:** Whisper truncates
`initial_prompt` to ~224 tokens keeping the **last** ones (whisper.h ~526) and its
influence **decays** over a long file (`carry_initial_prompt` is false by default),
so it is a marginal nudge on rare terms, **not** a guarantee — whole-file
conditioning is the primary fix. Word it accordingly in copy.

### 5.7 Audio retention + manual deletion (privacy surface)
Always-on retention requires user control + honest disclosure (posture in section 13):
- **Disclosure shipped WITH always-on** (not later): a first-run notice that
  recordings are saved **on this device only** (never uploaded) at `audio-captures/`,
  plus an in-app recording indicator. Update the web privacy policy (v2) + FAQ a4 to
  match.
- **Manual delete:** a minimal "저장된 녹음 관리" surface — list saved WAVs (date,
  length from WAV-header bytes, size) with per-item delete + "모든 녹음 삭제". New
  list/delete IPC channels (none exist today); delete is **path-contained** (only
  under `audio-captures/`). ja/en i18n.
- **Delete scope:** deleting a recording also deletes its **dump transcript.json**
  (the verbatim speech) — keeping the verbatim transcript after deleting the audio is
  a privacy surprise. The structured **note** persists. (Founder confirm — section 13.)
- No production "disable capture" toggle (no audio → no note); control is
  after-the-fact deletion.

---

## 6. File / component change map

| Area | File | Change |
|---|---|---|
| WAV writer | `desktop/src/main/audio-wav-writer.ts` | Refresh header each `append()`; `fdatasync`; surface write errors. |
| Renderer silence gate | `desktop/src/renderer/audio/orchestrator.ts:90-114` | Remove the `isSilent` drop — stream every chunk to main. |
| Capture gate + wavPath | `desktop/src/main/ipc.ts:554-578,148-151` | Remove opt-in gate → always open writer; promote `wavPath` to a session/orchestrator field; update PII comments. |
| Session start | `desktop/src/main/ipc.ts:542-591` | Stop loading STT at start (`orch.start()` no longer cold-loads STT); drop `stt-loading` start phase. Add a start precheck: stat `sttPath` + sidecar ready before recording. |
| Orchestrator | `desktop/src/main/sidecar/orchestrator.ts:629-663` | `start()` no longer loads STT; `onChunk` keeps `onAudioChunk` (WAV) but drops `stt.transcribe` + live accumulation; add `finalizeSegments` field + `wavPath`. |
| Live finalize prep | `desktop/src/main/ipc.ts:334-400,244-256` | New live-only prep: load STT(lang) → transcribeFile → store → dump → unload STT → load LLM. `loadLlmForFinalize` stays for from-dump. |
| STT engine | `desktop/src/main/engines/whisper-cpp-stt.ts` | Add `transcribeFile(path,{initialPrompt,language})`; apply `filterSegments(language)`. |
| Sidecar protocol | `desktop/src/shared/ipc-protocol.ts` | Add `transcribeFile` request + streamed progress/segments response. |
| C++ sidecar | `desktop/sidecar/src/ipc/json_protocol.cpp`, `.../stt/whisper_engine.*` | Handle `transcribeFile`: read WAV, `whisper_full` whole-file, `progress_callback`, `abort_callback`. Rebuild + sign + ctest (owns the rebuild). |
| STT-stall recovery | `desktop/src/main/...` | Dedicated STT recovery (restart → reload STT(lang) → re-issue once); NOT `makeRecoveringSidecarFor`. |
| Recording UI | `desktop/src/renderer/routes/Recording.tsx:244-266` | Level meter (ungated stream) + timer; drop captions + "N segments". |
| Renderer state / dead surface | `App.tsx`, `preload/index.ts:37-41`, `ipc.ts:299-321,309-313` | Remove `onChunk` sub + `View.segments`; empty-detection from WAV bytes/elapsed (`App.tsx:240`); `handleChunk` returns no segments. |
| Finalize progress | `curatingV2` renderer + finalize telemetry | Add the transcribe phase + `stt-transcribe-finalize` breadcrumb. |
| Retention UI + IPC | new surface + channels | List + delete (path-contained) saved recordings + transcript.json; on-device disclosure; i18n. |
| Privacy disclosure | web privacy v2 + FAQ a4 + first-run notice | Match the always-on posture. |
| Eval instrument | `desktop/scripts/transcribe-wav.ts` | Keep as the reference instrument; optionally repoint at `transcribeFile` once validated. |

---

## 7. Error handling & edge cases
- **WAV missing / unreadable at finalize** → clear error; orchestrator preserved;
  WAV (if present) kept for retry. Crash-safe header (5.1) keeps it decodable to the
  last full append.
- **STT load fails at finalize** → surfaced; no LLM load (floor respected); dump
  error record (5.6.2); retryable.
- **Transcription stall** → progress-based timeout + dedicated STT-stall recovery
  (5.3), NOT the LLM-reloading wrapper.
- **Long-silence hallucination/looping** → Whisper can fabricate or loop on long
  quiet stretches. Test recordings with extended silence; consider `whisper_full`
  VAD params (whisper.h ~587-590) if it surfaces.
- **Disk-full during capture** → surface + stop (5.1), do not swallow.
- **Empty / silent recording** → transcribeFile returns zero segments → IPC-level
  empty guard (4.2); renderer too-short detection from WAV bytes/elapsed.
- **Retry after note-gen failure** → reuse cached `finalizeSegments` (4.2), do not
  re-transcribe.
- **Discard** → delete the in-progress WAV (5.2/5.7).
- **Language** → session `language` (`ja`/`en`, `ipc.ts:523`) used for the STT load
  + filtering; turbo is multilingual.

## 8. Robustness invariants
1. **8 GB floor.** Transcription completes and STT is unloaded (mach-confirmed RSS
   drop, `orchestrator.ts:612-614`) **before** LLM load. The new STT-stall recovery
   must never load the LLM. Tests assert ordering.
2. **WAV is the only net.** No live transcript fallback exists → the gap-faithful,
   crash-safe, surfaced-on-error WAV (5.1) is mandatory, and retention is "keep"
   (decision 2). Cross-ref: diarization (parked) will consume this same transcript
   (section 3).
3. **One `whisper_full` call** is the conditioning invariant for accuracy; windowing
   (5.4) is a memory concession that must preserve conditioning via carried prompt
   tokens.

---

## 9. Measurement & acceptance (measure-first, falsifiable)
Accuracy is proven; the measurements gate the trade-offs. **BLOCKED until the
founder supplies the reference material.** Commit the corrected reference transcript
into the repo first.

1. **Accuracy (falsifiable).** On the named 10-min 会計 reference WAV + its committed
   corrected transcript: **proper-noun error count == 0** (whole-file) vs the live
   baseline's known errors; **CER strictly lower by a stated margin** (not "≤" or
   "~0"). Instruments: `transcribe-wav.ts` (whole-file) vs the live path;
   `eval-stt.ts` (synthetic far-field).
2. **Latency.** Finalize transcription wall-time vs length (10/30/60 min) on M1 8 GB
   from a measured diagnostic (`wall_ms`), not an estimate → real-time factor →
   calibrate the progress copy.
3. **Memory (ceiling).** Peak RSS during whole-file transcription stays **below a
   stated ceiling** (e.g. < 4.5 GB) before LLM load. Breaching it triggers windowing
   (5.4).
4. **Crash recovery.** Kill the app mid-recording → the WAV decodes (header current,
   `fdatasync`) → finalize from it produces a note.

**Acceptance gate:** notes built from the accurate transcript pass the faithfulness
gate (#124); finalize order (transcribe → STT-unload → LLM-load) holds; recording
loads no STT model; WAV duration == elapsed across silence.

## 10. Testing plan
- **Unit (fail-first where they assert a fix):**
  - Crash-safe header: byte-level asserts on RIFF size (offset 4) + data size
    (offset 40) **after append-without-close**, demonstrated to FAIL on the
    pre-change writer (`audio-wav-writer.ts:27,46`).
  - WAV duration == elapsed across silent gaps (silence-gate-removal fixture).
  - Finalize order (transcribe → STT-unload → LLM-load) via mocks.
  - `filterSegments(language)` parity between `transcribe` and `transcribeFile`.
  - `finalizeSegments` cache: a note-gen retry does not re-transcribe.
  - Empty-recording guard keyed on zero transcribeFile segments; renderer
    too-short from WAV bytes/elapsed.
  - From-dump path never transcribes.
  - Disk-full append surfaces (not swallowed).
- **Integration:** record (synthetic audio incl. silence) → WAV on disk → finalize
  transcribes WAV (mock or env-gated real STT) → note for each of the 4 families.
- **Windowing (if built):** fail-first seam fixture — no drop/dup across a window seam.
- **Tests to update/remove:** the live-segment assertions that record-only
  invalidates — `orchestrator.test.ts:107`, `ipc.test.ts:364-370,439` (update the
  file-header docstrings in the same commit, per the `(test-headers)` rule).
- **Real-STT tests:** env-gated, scoped to explicit files, `afterAll` sidecar
  cleanup + post-scan; **CI runs the mocked path only**, real-STT is manual
  (zombie-safe per the hard rules: never run full `pnpm verify`/`test`; never
  `run_in_background` heavy LLM/STT).

---

## 11. Phasing (decomposition for the implementation plan)
This is too large for one undifferentiated effort (rule #5). Cut:
- **2a — core record-then-transcribe.** Crash-safe + gap-faithful WAV; remove live
  STT (orchestrator/renderer/dead surface); level meter; `transcribeFile` (C++ +
  rebuild/sign **or** the TS-windowed fallback if avoiding C++ in the first cut);
  live-finalize prep (transcribe → unload → LLM); empty guard; finalize progress;
  first-run disclosure (gates always-on). Ships the user-visible win.
- **2b — retention management UI** (list/delete + transcript.json delete + privacy
  copy). Gated on section 13.
- **2c — windowing** (only if section-9 RSS breaches the ceiling).
- **2d — unfinalized-recording recovery** (deferrable).

## 12. Alternatives considered
- **Keep live STT + re-transcribe at finalize** (prior memory framing) — rejected:
  transcribes twice, keeps bad live captions, keeps STT resident during recording.
- **Improve the live chunked path** (cross-chunk conditioning + 20-30s windows) —
  rejected: adds live latency, risks error propagation, doesn't remove the
  wrong-captions impression; founder evidence is for the whole-file pass.
- **TS-windowed finalize transcription** — kept only as the 5.4 memory guard / a
  no-C++ first cut; primary is path-based whole-file for maximal conditioning.
- **Quick note first, upgrade in background** (decision-2 option C) — deferred; no
  live transcript to seed it.
- **Reuse `makeRecoveringSidecarFor` for STT stalls** — rejected: it reloads the LLM
  (`ipc.ts:277-279`), violating the 8 GB floor under a loaded STT.
- **Durability via `writeSync` alone** — rejected: not `fsync`; add `fdatasync` or
  downgrade the claim.

## 13. Founder ratification — privacy/retention posture
Independent review flagged that always-on retention flips a documented
PII-off-by-default contract (`ipc.ts:148-151`). The founder already chose **keep +
manual delete** (decision 2). Proceeding default (vetoable):
- **Posture:** always-on capture **with a first-run disclosure + in-app recording
  indicator**, retained on-device, **manual delete** (no silent opt-out; no
  auto-purge). Matches decision 2.
- **Delete scope:** deleting a recording deletes audio **and** its verbatim
  transcript.json; the structured note stays.
- **PRD:** add a short "Data & retention" invariant to `docs/PRD.md` (the yardstick
  is currently silent on retention) — proposed as a reviewable change, not silently
  edited.

**Open to the founder:** prefer instead (b) a real retain-audio opt-out, or (c)
auto-purge after N days? And is a minimal manage-recordings list acceptable for the
first cut, or wait for History? (Recommendation: ship the default above + the minimal
list.) Engineering proceeds on 2a regardless; 2b/PRD follow this answer.

## 14. Founder inputs (unblock the gates)
- **Eval material:** the named 10-min 会計 WAV + one committed corrected transcript
  (section 9). Blocks the acceptance gates.
- **Glossary:** optional `glossary.json` — a marginal boost now (whole-file is
  already clean), free to supply.
