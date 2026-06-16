# STT Phase 2 — Record-then-Transcribe (finalize-time whole-file STT)

**Date:** 2026-06-16
**Status:** Design — pending founder review
**Track:** STT accuracy (v2 on-device desktop app, `desktop/`)
**Supersedes the framing in:** `v2_next_steps_stt_and_cleanup_2026-06-15` memory
("re-transcribe saved WAV at finalize, keep live captions"). The founder
upgraded the direction in the 2026-06-16 brainstorm: **drop live captions
entirely** — record only, transcribe once at finalize.
**Builds on (merged):** PR #132 (`f415237`) — large-v3-turbo default STT +
Whisper `initial_prompt` glossary mechanism + audio-save hook + `transcribe-wav.ts`.

---

## 1. Problem

Live transcription quality is the user-visible gate ("처참"), and the
worst offenders are **proper nouns**. The root cause is **not** the model's
vocabulary — it is the **10-second chunking**.

During a recording the app cuts audio into ~10s chunks and transcribes each
one **in isolation** (`orchestrator.ts:653-662` → `stt.transcribe(chunk)`).
Whisper sees no surrounding context, so it cannot disambiguate homophones
and domain terms.

**Founder evidence (real 10-min 会計 podcast, 2026-06-15):** the same audio,
two passes:

| Pass | Proper nouns |
|---|---|
| Live (10s chunks) | 起用価値 ✗ · Hashflow ✗ · 海峡 ✗ · 会談 ✗ · ファイナス ✗ · サダキ ✗ |
| Whole-file (turbo) | 企業価値 ✓ · 田中千一 ✓ · 佐々木 ✓ · 会計 ✓ · ファイナンス ✓ — **0 wrong forms** |

A whole-file pass gives Whisper its full internal 30s windows **plus running
text conditioning across the whole recording**. That, not a better model, is
what fixes the proper nouns. The win is therefore **already empirically
proven** for accuracy; this spec is about the architecture to deliver it and
the trade-offs that come with it.

---

## 2. The decision (what changes)

**Stop doing live transcription. Record only. Transcribe once, accurately, at
finalize.**

```
Recording phase   audio capture → save to one WAV on disk        (no STT model loaded)
                  renderer shows: level meter + elapsed time

Stop → finalize   load STT → transcribe the whole WAV (turbo + glossary)
                  → unload STT → load LLM → generate structured note
                  → keep the WAV on disk
```

Live captions, per-chunk STT, dual transcript accumulation, and STT-at-start
all go away. The note pipeline (silence-aware chunking → grammar LLM → all 4
families) is **unchanged** — it just receives a more accurate transcript.

### 2.1 Founder decisions locked (2026-06-16 brainstorm)

1. **No live captions.** During recording the screen shows a **level meter +
   elapsed time + "녹음 중" state** — proof the mic is capturing, without
   showing wrong text. (Confirmed against PRD: "live audio → structured notes"
   means *live audio input*, not *live caption display*; the deliverable is the
   note, generated at finalize. No PRD violation.)
2. **Audio retention = keep + manual delete.** The session WAV is **always
   saved** (no longer opt-in) and **retained after finalize**. The user can
   delete recordings manually. This makes the WAV the single durable source of
   truth (and a crash safety net).
3. **Latency policy = always transcribe + show progress.** Every recording,
   any length. Finalize shows "오디오 받아쓰는 중… → 노트 작성 중…". Founder
   has accepted "쪼개서 하니 길어도 시간만 더면 OK". (Decision 2 option C —
   "quick note first, upgrade in background" — is explicitly deferred; with no
   live transcript there is nothing to build a quick note from anyway.)

### 2.2 Why this is better than the prior "keep live + re-transcribe" framing

- **No double work.** The prior plan transcribed everything live *and* again
  at finalize — the same audio twice. Record-only transcribes **once**. The
  finalize wait is identical, but all the live STT compute during recording
  disappears.
- **Memory / heat / battery.** No STT model (~1.5 GB RSS) resident during
  recording. Big win on 8 GB M1, especially for long recordings. STT is loaded
  only for the finalize pass.
- **Removes the bad first impression.** Wrong captions streaming live erode
  trust even if the final note is fixed. Showing nothing-but-a-level-meter is
  strictly better than showing wrong text.
- **Faster start.** Start no longer blocks on a 60s STT cold-load
  (`orchestrator.ts:634-638`); recording begins as soon as the mic is live.

---

## 3. Goals / non-goals

### Goals
- Final note (all 4 families) is built from a whole-file, context-conditioned
  transcript → proper-noun errors → ~0 without a glossary.
- Recording is lightweight: no model resident, crash-safe audio capture.
- Finalize latency is honest and visible (progress for both the transcription
  and note phases).
- The saved WAV is a durable, decodable-at-all-times artifact the user controls.

### Non-goals (this spec)
- **History viewer** (#113/F2, still unimplemented). We only note the
  integration point: kept WAVs enable a future "re-transcribe / regenerate from
  History". Not built here.
- **Diarization** (parked). Design is diarization-agnostic; when it resumes it
  runs on the finalize transcript (single-speaker collapse stays as today).
- **LLM 2nd-pass text correction** (deferred — fabrication risk, per memory).
- **Unfinalized-recording auto-recovery UI** — defined in section 8.3 as a
  deferrable Phase 2b; the crash-safe WAV that enables it IS in scope.

---

## 4. Architecture

Two cleanly separated phases. The model lifecycle never overlaps (8 GB floor).

### 4.1 Recording phase (no model loaded)

| Concern | Today | New |
|---|---|---|
| STT model | loaded at `orch.start()` | **not loaded** |
| Per-chunk audio | `onChunk` → `stt.transcribe` → accumulate segments | `onChunk` → **append to WAV only** |
| WAV capture | gated OFF (`ipc.ts:561-563`) | **always on** |
| WAV durability | header patched on `close()` only (`audio-wav-writer.ts:46`) | **header refreshed each append** (crash-safe) |
| Renderer | live-caption list + "N segments" (`Recording.tsx:255-266`) | **level meter + elapsed time** |
| Start latency | blocks on STT cold-load | mic-init only (fast) |

The renderer keeps sending chunks to main (`window.lisna.sendChunk`) so main
can own the WAV file. The **level meter is computed renderer-locally** (RMS/peak
of the captured audio) — no IPC round-trip, no STT.

### 4.2 Finalize phase (the new transcription step)

Inserted into the existing `getCurrentSession` → `loadLlmForFinalize` sequence
(`ipc.ts:334-400`, `244-256`). New order:

```
1. Resolve session WAV path (from the orchestrator).
2. Load STT (turbo).                          ← was at session start; now here
3. Transcribe the WHOLE WAV in one conditioned pass,
   with the glossary initial_prompt (reuse loadGlossaryInitialPrompt()).
   → TranscriptSegment[] with ABSOLUTE timestamps (one call → no re-anchoring).
4. Cache those segments on the orchestrator (transcribe once; reused on retry).
5. Write them to the debug dump transcript.json (now the ACCURATE transcript).
6. Unload STT (existing mach-confirmed RSS drop), then load LLM.
7. adaptToV2Transcript(segments) → existing chunking → grammar LLM → note.
8. Keep the WAV (do not delete).
```

Steps 3-6 replace today's "STT unload (no-op, never loaded at finalize) → LLM
load". The transcription happens **while STT is loaded and before LLM load**,
so the two models never coexist.

**Failure/retry:** on a note-gen failure the orchestrator is preserved (P0-3,
`session-finalize.ts:245-252`). Because the transcription is cached on the
orchestrator (step 4), a retry **reuses** the transcript and only re-runs note
generation — it does not re-transcribe.

---

## 5. Detailed design

### 5.1 Always-on, crash-safe audio capture

- **Remove the gate.** `ipc.ts:554-578` currently opens the `WavWriter` only when
  `LISNA_SAVE_AUDIO=1` or `save-audio.on` exists. The WAV is now **mandatory**
  (no audio → no note), so the writer always opens at session start. Keep an env
  override only as a kill-switch for tests/debug, not for production users.
- **Crash-safe header.** `WavWriter.append()` (`audio-wav-writer.ts:31-41`)
  must, after writing samples, also rewrite the 44-byte header with the
  current `dataBytes` at offset 0:
  `fs.writeSync(fd, header(this.dataBytes), 0, 44, 0)`. This is a pwrite at
  position 0 and does **not** disturb the append cursor (`this.pos`). Result:
  the file is a valid, decodable WAV at all times (minus at most the last
  partial chunk). Cost: one 44-byte write per append — negligible. This is the
  load-bearing change that lets the WAV be the sole source with no live-transcript
  safety net.
- **Chunk granularity.** Decouple the WAV-append chunk from the old 10s STT
  window. A smaller append chunk (≈1s) tightens crash-recovery granularity and
  raises level-meter responsiveness. (Renderer chunker: `chunker.ts`,
  `firstChunkSec`/`chunkSec` in `renderer/audio/orchestrator.ts`.)
- **Storage.** `<userData>/audio-captures/<ISO-timestamp>.wav`, 16 kHz mono
  PCM16 (unchanged from #132).

### 5.2 Recording UI — level meter

- Replace the live-caption block (`Recording.tsx:255-266`) and the
  "· N segments" counter (`:247`) with a **level meter** (a horizontal bar
  driven by renderer-local RMS/peak, ~15-20 fps) + the existing elapsed timer
  (`:246`) + a clear "녹음 중" indicator.
- Remove the renderer `segments` state and the `window.lisna.onChunk`
  subscription that fed live captions (App.tsx accumulation). Main's
  `handleChunk` (`ipc.ts:299-321`) stops returning segments — it only forwards
  audio to the WAV writer.
- This is a **dense work surface**, so it stays function-first (level meter +
  timer), not legal-pad decoration (per `web-design.md` scope-boundary rule).

### 5.3 Finalize transcription primitive

The whole-file pass needs a primitive that the existing per-chunk
`WhisperCppSTT.transcribe` is unsuited for, because:
- it **base64-encodes the whole buffer into one NDJSON message**
  (`whisper-cpp-stt.ts:31-32`) — a 60-min recording is ~115 MB PCM → ~154 MB
  base64 in a single line; unacceptable;
- it has a **fixed 120s timeout** (`:40`) — far too short for a long file.

**Recommended primitive — path-based `transcribeFile` sidecar command:**

- New sidecar request `{ type: 'transcribeFile', path, sampleRate?, initialPrompt? }`
  and a streamed/segmented response. The C++ sidecar **reads the WAV from disk**
  (it already reads model files from paths) and runs `whisper_full` on the full
  buffer in **one conditioned pass** — exactly reproducing the founder's proven
  whole-file result.
- No base64 over IPC. Timeout is **progress-based** (no-progress window), mirroring
  the LLM generate guard, not a fixed wall-clock cap.
- Optional progress: `whisper_full_params.progress_callback` emits "% of audio
  decoded" events → the finalize progress UI (section 5.5). If we skip the C++
  progress callback in the first cut, TS can show an estimated bar from
  elapsed/expected-duration (no C++ change for a basic indicator).
- TS surface: a `transcribeFile(path, { initialPrompt })` method on the STT
  engine; `transcribe-wav.ts` can be repointed at it to keep one code path.

**Alternative considered — TS-windowed (no C++ change):** read the WAV in TS and
feed the existing base64 `transcribe` in large overlapping windows (e.g. 3-5 min
windows, ~15s overlap, dedupe at seams). Lower risk (TS-only, no sidecar rebuild)
but loses Whisper's cross-window conditioning at each seam and adds windowing/
dedup logic. **Decision: path-based `transcribeFile` is the target** (cleanest data
flow, best accuracy, single conditioned pass). The TS-windowed approach is the
fallback if the implementation plan chooses to avoid a sidecar rebuild in the
first cut, or as the **long-recording memory guard** (see 5.4).

### 5.4 Memory guard for long recordings

Peak finalize RSS = STT model (~1.5 GB) + the audio buffer + Whisper mel/KV
(LLM is NOT loaded yet, so there is headroom). A 2-hour recording is ~230 MB
PCM (~460 MB as float). For typical lengths (≤ ~60-90 min) a single whole-file
pass fits comfortably.

- Define a length/size threshold constant (start generous, validated by the
  memory measurement in section 9). Below it: single whole-file pass. Above it:
  **large overlapping windows** (the C++ side may window internally, or fall
  back to the TS-windowed path) to bound peak memory while preserving most
  conditioning via overlap.
- This threshold is a tuned constant, not a TBD — ship a concrete default
  (proposed: window when recording > 90 min, 6-min windows, 15s overlap) and
  adjust from the measured RSS curve.

### 5.5 Finalize progress UI

Decision 3 (always transcribe + show progress). Extend the existing finalize
progress UI (#122, `curatingV2` state) with a **transcription phase before** the
note phase:

- Phase A "오디오 받아쓰는 중…" with an elapsed timer and (if available) a
  percent from the Whisper progress callback.
- Phase B "노트 작성 중…" — the existing chunk/attempt/elapsed display.

Add a `sessionLog.phase('stt-transcribe-finalize', ms)` breadcrumb (mirrors the
existing `stt-unload-finalize` / `llm-load-finalize` phase logs at
`ipc.ts:252,255`) so a long Stop→Note interval is attributable to transcription
vs note-gen in `main.log`.

### 5.6 Transcript → note integration (unchanged downstream)

The whole-file pass returns `TranscriptSegment[]` (`{startSec, endSec, text,
noSpeechProb?}`) with absolute timestamps. These flow into the existing pipeline
with **no downstream changes**:

`segments` (now from transcription, not live accumulation) → `adaptToV2Transcript`
(`session-finalize.ts:176`) → `chunkTranscript` (silence-aware) → per-family
`finalize*` → grammar LLM → note. Family routing, diarization-disabled collapse,
provenance, and the 4 renderers are untouched.

The glossary `initial_prompt` (reuse `loadGlossaryInitialPrompt()`,
`ipc.ts:229-237`) is applied to the finalize transcription. It is now secondary
(whole-file is already proper-noun-clean) but free and still helps rare in-domain
terms.

### 5.7 Audio retention + manual deletion (privacy surface)

Because audio is now always retained on disk, the app must give the user control
and clear disclosure:

- **Disclosure:** state plainly that recordings are saved **on this device only**
  (never uploaded — consistent with Lisna's concept) and where (`audio-captures/`).
- **Manual delete:** a minimal "저장된 녹음 관리" surface — list saved WAVs
  (date, length, size) with per-item delete and a "모든 녹음 삭제" action.
  Deleting a recording's WAV does not delete its already-generated note (the
  accurate transcript text persists in the dump). This surface can later merge
  into the History viewer; for now a minimal settings entry suffices.
- No production "disable capture" toggle (no audio → no note). Control is
  after-the-fact deletion.

---

## 6. File / component change map

| Area | File | Change |
|---|---|---|
| WAV writer | `desktop/src/main/audio-wav-writer.ts` | Refresh header each `append()` (crash-safe). |
| Capture gate | `desktop/src/main/ipc.ts:554-578` | Remove opt-in gate → always open writer. Expose WAV path on the orchestrator/session. |
| Session start | `desktop/src/main/ipc.ts:542-591` | Stop loading STT at start; `orch.start()` no longer cold-loads the STT model. Remove `stt-loading` start phase. |
| Orchestrator | `desktop/src/main/sidecar/orchestrator.ts:629-663` | `start()` no longer loads STT; `onChunk` writes WAV only (drop `stt.transcribe` + segment accumulation). Add a finalize-transcription cache field + the WAV path. |
| Finalize seq | `desktop/src/main/ipc.ts:334-400`, `244-256` | Insert: load STT → `transcribeFile(wavPath, {initialPrompt})` → cache → write dump transcript → unload STT → load LLM. Build `SessionContext.segments` from the transcription instead of `exposedSegments`. |
| STT engine | `desktop/src/main/engines/whisper-cpp-stt.ts` | Add `transcribeFile(path, opts)` (path-based, progress-based timeout). |
| Sidecar protocol | `desktop/src/shared/ipc-protocol.ts` | Add `transcribeFile` request + progress/segments response. |
| C++ sidecar | `desktop/sidecar/src/ipc/json_protocol.cpp`, `desktop/sidecar/src/stt/whisper_engine.*` | Handle `transcribeFile`: read WAV, `whisper_full` whole-file, optional `progress_callback`. Rebuild + ctest. |
| Recording UI | `desktop/src/renderer/routes/Recording.tsx:244-266` | Replace live captions + "N segments" with a level meter; keep elapsed timer. |
| Renderer state | `desktop/src/renderer/App.tsx` | Remove live `segments` accumulation + `onChunk` subscription. |
| Chunk handler | `desktop/src/main/ipc.ts:299-321` | `handleChunk` forwards audio to WAV writer only; stops returning segments. |
| Finalize progress | `curatingV2` renderer + `session/finalize` telemetry | Add the "transcribing" phase + `stt-transcribe-finalize` breadcrumb. |
| Retention UI | new minimal settings surface | List + delete saved recordings; on-device disclosure. |
| Eval instrument | `desktop/scripts/transcribe-wav.ts` | Optionally repoint at `transcribeFile` to share one path. |

---

## 7. Error handling & edge cases

- **WAV missing / unreadable at finalize** → clear error, orchestrator preserved,
  WAV (if present) kept so the user can retry. With a corrupt header from a hard
  crash, the crash-safe writer (5.1) means the file is still decodable up to the
  last full append.
- **STT load fails at finalize** → surfaced as a load error; no LLM load attempted
  (memory floor respected); retryable.
- **Transcription stall** → progress-based no-progress timeout (not a fixed 120s);
  reuse the sidecar restart/recovery machinery (`makeRecoveringSidecarFor`,
  `ipc.ts:264-289`) where applicable.
- **Empty / silent recording** → transcription returns no segments → existing
  empty-output handling in the note pipeline applies (loud, not fabricated).
- **Force-quit mid-recording** → header is current (5.1) → WAV is finalizable
  later (recovery, 8.3).
- **Retry after note-gen failure** → reuse cached transcription, do not
  re-transcribe (4.2 step 4).
- **Language** → keep the session's `language` (`ja`/`en`, `ipc.ts:523`) for the
  finalize transcription; turbo is multilingual.

---

## 8. Robustness details

### 8.1 Model lifecycle ordering (the 8 GB invariant)
The transcription MUST complete and STT MUST be unloaded (mach-confirmed RSS drop,
`orchestrator.ts:612-614`) **before** LLM load. The spec's finalize sequence
(4.2) enforces this. Tests assert the order.

### 8.2 No live-transcript safety net → WAV is the net
Previously a crash/failure still left the live-accumulated transcript. Now the
WAV is the only source, which is why 5.1 (always-valid header) is mandatory and
why retention is "keep" (decision 2).

### 8.3 Unfinalized-recording recovery (Phase 2b, deferrable)
On launch, detect `audio-captures/` WAVs with no finalized note and offer
"이 녹음으로 노트 만들기". Enabled by the crash-safe WAV + kept audio. Defined here
for completeness; not required for the first cut.

---

## 9. Measurement & acceptance (measure-first)

The accuracy win is already proven; the measurements gate the trade-offs.

1. **Accuracy (confirm).** On founder-provided real WAV(s) + a corrected
   reference, whole-file finalize CER ≤ live-chunked CER and proper-noun error
   count → ~0. Instruments: `transcribe-wav.ts` (whole-file) vs the live path;
   `eval-stt.ts` for synthetic far-field. *Founder input: ≥1 real WAV + one
   corrected transcript (founder is the eval-set owner).*
2. **Latency.** Finalize transcription wall-time vs recording length
   (10 / 30 / 60 min) on M1 8 GB → real-time factor. Calibrate the progress ETA;
   confirm acceptability.
3. **Memory.** Peak RSS during whole-file transcription (STT + audio buffer)
   stays within 8 GB headroom before LLM load. Validates the windowing threshold
   (5.4).
4. **Crash recovery.** Kill the app mid-recording → the WAV decodes → finalize
   from that WAV produces a note.

**Acceptance gate:** notes built from the accurate transcript pass the
faithfulness gate (#124); finalize order (transcribe → STT-unload → LLM-load)
holds; recording loads no STT model.

---

## 10. Testing plan

- **Unit:** crash-safe header (append without close → file decodes); finalize
  sequence order (transcribe before STT-unload before LLM-load) via mocks;
  glossary read at finalize; `SessionContext.segments` sourced from transcription;
  renderer level-meter RMS; `handleChunk` writes WAV / returns no segments.
- **Integration:** record (synthetic audio) → WAV on disk → finalize transcribes
  WAV (mock or env-gated real STT) → note for each of the 4 families.
- **Regression:** recording phase loads no STT model (assert no `loadModel`
  during recording); chunk path still appends WAV.
- **Real-STT tests:** env-gated, scoped to explicit files, `afterAll` sidecar
  cleanup + post-scan (zombie-safe per the hard rules: never run full
  `pnpm verify`/`test`; never `run_in_background` heavy LLM/STT).
- **Eval reuse:** `eval-stt.ts` / `transcribe-wav.ts` for the accuracy numbers.

---

## 11. Alternatives considered

- **Keep live STT + re-transcribe at finalize** (the prior memory framing) —
  rejected: transcribes the same audio twice, keeps the bad live captions, keeps
  STT resident during recording.
- **Improve the live chunked path** (cross-chunk text conditioning + 20-30s
  windows) — rejected: adds live-caption latency, risks error propagation across
  chunks, does not remove the wrong-captions impression, and the founder's
  evidence is specifically for the whole-file pass.
- **TS-windowed finalize transcription** — viable, lower-risk fallback; kept as
  the long-recording memory guard. Primary is the path-based whole-file
  `transcribeFile` for maximal conditioning.
- **Quick note first, upgrade in background** (decision 2 option C) — deferred;
  more moving parts and, with no live transcript, nothing to seed a quick note.

---

## 12. Open questions / founder inputs

- **Eval material:** ≥1 real WAV + one corrected reference transcript to lock the
  accuracy + latency numbers (section 9). The 10-min 会計 podcast already shown is
  a strong start.
- **Glossary:** optional `glossary.json` of recurring proper nouns/terms — now a
  secondary boost (whole-file is already clean), still free to supply.
- **Retention UX scope:** is a minimal settings "manage recordings" list enough
  for the first cut, or should deletion wait to land inside the History viewer?
  (Recommendation: ship the minimal list now; merge into History later.)
