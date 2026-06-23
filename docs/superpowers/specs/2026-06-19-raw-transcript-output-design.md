# Raw-transcript output mode — design

**Date:** 2026-06-19
**Status:** approved (founder go-ahead "진행" 2026-06-19)
**Branch:** `feat/stt-finalize-transcription` (continues STT Phase 2a)

## Goal

Add a 5th choice to the post-Stop family picker: **"文字起こし" (raw transcript)**. When
picked, Lisna shows the whole-recording transcript verbatim — subtitle-style — **without
generating a structured note**. This is faster (no LLM load/gen) and doubles as a way to
inspect STT quality on its own.

## Why this fits

PRD core value is "spoken audio → structured notes". A raw transcript is the verbatim
intermediate, offered as a complement (not a new product direction): same capture, same
whole-WAV STT, just a different terminal output. No non-goal forbids it. It reuses data the
finalize path already produces.

## Architecture decision

**Transcript is NOT a `NoteFamily`.** The `NoteFamily` enum
(`lecture|meeting|interview|brainstorm`, `base.ts`) is the LLM-note discriminator used by
note schemas, family cores, and the renderer registry everywhere. A transcript has no LLM
step and no `NoteBase`. Polluting the enum would force a fake "core"/schema/renderer.

Instead the picker selection widens to **`NoteFamily | 'transcript'`**, and `'transcript'`
routes to a **separate, LLM-free finalize path** with its own result type and view.

## Data flow

```
Stop → familyPicking
  ├─ pick a family  → curatingV2 → (transcribe WAV → load LLM → note) → note view   [unchanged]
  └─ pick 'transcript' → transcribing → (transcribe WAV only) → transcript view      [NEW]
```

The note path (ipc.ts `getCurrentSession`) does, in order:
**(A)** create dump → **(B)** transcribe whole WAV (cache on orchestrator) → **(C)** empty
guard → **(D)** write `transcript.json` → **(E)** load LLM → **(F)** note gen.

The transcript path reuses **(A)–(D)** and stops — no (E)/(F). It returns the cached
segments. Both reuse `transcribeWavForFinalize` (the delicate STT-load→transcribe→unload,
8 GB-floor logic stays single-sourced) and `orch.exposedSegments`/`setFinalizeSegments` (so
if a note finalize already transcribed this session, the transcript path reuses the cache and
does NOT re-transcribe — and vice-versa).

## Components

### 1. IPC — new `session/transcribe` channel
- Registered inside `registerSessionFinalize` so it **shares the `finalizeInFlight` flag**
  (a transcript run and a note finalize must never race the single-threaded sidecar).
- New dep `getTranscript: () => Promise<SessionTranscribeResult>` wired in `ipc.ts`. It mirrors
  `getCurrentSession`'s (A)–(D) but skips (E)/(F): resolve `current` + paths + client →
  create dump → if `exposedSegments` empty: `transcribeWavForFinalize` + `setFinalizeSegments`
  → `WAV_MISSING`/`EMPTY_RECORDING` guards (same as the note path) → write `transcript.json`
  → return `{ sessionId:'live', language, segments, durationSec }`. **No LLM load.**
- Settle: on success clear the live session (mirror the note-success clear:
  `current`/`_llmLoadedForCurrent`/`recording`); on failure PRESERVE (so the user can retry,
  same P0-3 contract as note finalize — the transcript is also cached on the orchestrator).
  Reuse the existing settle/clear; the LLM-unload it performs is a harmless no-op here (no LLM
  was loaded).

### 2. Protocol — `SessionTranscribeResult` (`ipc-protocol.ts`)
```ts
export interface SessionTranscribeResult {
  sessionId: string;
  language: string;
  segments: TranscriptSegment[];
  durationSec?: number;   // last segment endSec, for the view header
}
```

### 3. Preload bridge (`preload/index.ts`)
`transcribeOnly(): Promise<SessionTranscribeResult>` → `invoke('session/transcribe')`.

### 4. Family picker (`FamilyPickerStep.tsx`)
- `onPick` widens to `(choice: NoteFamily | 'transcript') => void`.
- Add a 5th entry, visually set apart (it is an output format, not a "session type"): a short
  divider/caption like 「またはノートにせず…」 then the `文字起こし` radio with desc
  「録音をそのまま字幕で表示（ノート生成なし）」.

### 5. Renderer FSM (`App.tsx`)
- New view states: `{ kind: 'transcribing' }` (loading) and
  `{ kind: 'transcript'; segments: TranscriptSegment[]; language: string; durationSec?: number }`.
- Picker `onPick`: if `'transcript'` → set `transcribing` + call `runTranscribe()`
  (success → `transcript`, error → `error`); else the existing note path.
- `transcribing` renders a minimal spinner + 「文字起こし中…」 + elapsed (reuse `Spinner`;
  no fake %). Group F's real transcribe-progress, when it lands, can replace the spinner here
  too — out of scope now.

### 6. `TranscriptView` (`renderer/routes/TranscriptView.tsx`, NEW)
- Props `{ segments, language, durationSec, onNewSession }`.
- Renders subtitle lines: `[m:ss] テキスト` per segment (timestamp from `startSec`),
  monospace, scrollable — same shape as the existing history-detail transcript display.
- A 新しい録音 button → `onNewSession` (→ recording). Function-first styling (work surface,
  no legal-pad decoration).

### 7. History
The transcript path writes `transcript.json` (step D), so the run appears in the history list
automatically (`DumpSummary` derives its row from `transcript.json`; `family`/`ok` are optional
and simply absent). No `result.json` is required. A user can later regenerate a NOTE from that
saved transcript via the existing `finalizeFromDump` path.

## Error handling
Reuse the note path's codes: `WAV_MISSING`, `EMPTY_RECORDING`, `FINALIZE_IN_FLIGHT` (shared
flag), `NO_ACTIVE_SESSION`. They surface in the renderer `error` view exactly as the note path
does. (These three Phase-2 codes still lack tailored JA copy — a separate pre-existing gap,
tracked in memory; out of scope here.)

## Testing
- `ipc.test.ts`: `session/transcribe` returns the transcribed segments; does NOT load the LLM
  (assert no `llm.loadModel`); reuses the orchestrator transcript cache (no re-transcribe when
  `exposedSegments` already set); shares `finalizeInFlight` with note finalize; writes
  `transcript.json`; `EMPTY_RECORDING`/`WAV_MISSING` guards fire; clears the session on success.
- `FamilyPickerStep.test.tsx`: the 5th `transcript` choice renders + `onPick('transcript')`
  fires.
- `TranscriptView.test.tsx`: renders one `[m:ss] text` line per segment; new-session button.
- App FSM: a focused unit on the picker→transcribing→transcript transition (pure helper if
  extractable, mirroring `recording-stop.test.ts`).

## Non-goals (YAGNI)
- No transcript editing / export / copy-all (just view). 
- No speaker labels (diarization is parked).
- No live/streaming transcript (whole-WAV at finalize only).
- `'transcript'` never enters the `NoteFamily` enum, schemas, cores, or the renderer registry.
- No new finalize-progress UI here (Group F covers the transcribe-progress bar for both paths).

## Delivery
After implementation + independent review per commit (marker-gated) + scoped tests, rebuild +
reinstall `/Applications/Lisna.app` (light path — sidecar already current) so the founder can
pick 文字起こし and see the raw transcript.
