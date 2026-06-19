# Raw-transcript output mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "文字起こし" choice to the post-Stop family picker that shows the whole-recording transcript verbatim (subtitle-style) with NO LLM note generation.

**Architecture:** The picker selection widens to `NoteFamily | 'transcript'`. `'transcript'` routes to a new LLM-free IPC path (`session/transcribe`) that reuses the existing whole-WAV transcription (`transcribeWavForFinalize` + the orchestrator transcript cache + the debug dump) and stops before the LLM load. The renderer shows a new `TranscriptView`. Transcript runs land in history via `transcript.json` (no `result.json` needed).

**Tech Stack:** Electron (main + preload + React renderer), TypeScript, Vitest. No new deps.

**Reference spec:** `docs/superpowers/specs/2026-06-19-raw-transcript-output-design.md`.

## Global Constraints

- **Test runner:** `pnpm --filter @lisna/desktop exec vitest run <explicit-file>` — NEVER the bare/whole suite; never `pnpm verify`/`test`; never `run_in_background` for tests. Scan zombies after (`pgrep -fl "llama-completion|llama-cli|whisper-cli|desktop/resources/sidecar|vitest|electron-vite"`).
- **Self-checks per commit:** `pnpm --filter @lisna/desktop typecheck` + `pnpm --filter @lisna/desktop lint` + the task's scoped vitest file. All must be green.
- **`'transcript'` is NOT a `NoteFamily`** — never add it to the `NoteFamilySchema` enum, family cores, schemas, or `familyRendererRegistry`.
- **Work surface = function-first** — `TranscriptView` uses plain/inline styles, NO legal-pad/`.postit`/`.pencil` decoration (`.claude/rules/web-design.md` scope boundary).
- **Desktop app is JA-locked** — user-facing strings are Japanese (no web i18n parity rule; that's `web/` only).
- **Commits:** `type(scope): summary` ≤72 chars; one concern; Co-Authored-By trailer. Commits are precommit-marker-gated (repo_id `0addba31cddc`): implementer STAGES + STOPS; an independent opus reviewer runs typecheck + scoped test + the 9-checklist + writes the marker; controller commits.
- **Plan line-refs may be STALE** — re-read each live file before editing.

---

### Task 1: Backend `session/transcribe` — transcribe-only IPC path

**Files:**
- Modify: `desktop/src/shared/ipc-protocol.ts` (add `SessionTranscribeResult`)
- Modify: `desktop/src/main/sidecar/ipc/session-finalize.ts` (add `getTranscript` dep + `SESSION_TRANSCRIBE_CHANNEL` + handler + extend `SessionSettleResult`)
- Modify: `desktop/src/main/ipc.ts` (add `CHANNELS.sessionTranscribe`; wire `getTranscript`; handle the transcript settle in `onSessionSettled`)
- Modify: `desktop/src/preload/index.ts` (add `transcribeOnly()` bridge + `Window.lisna` decl)
- Test: `desktop/src/main/__tests__/ipc.test.ts`

**Interfaces:**
- Produces: `window.lisna.transcribeOnly(): Promise<SessionTranscribeResult>` where
  ```ts
  interface SessionTranscribeResult { sessionId: string; language: string; segments: TranscriptSegment[]; durationSec?: number }
  ```
  Channel: `'session/transcribe'`. Rejects with `NO_ACTIVE_SESSION` / `WAV_MISSING` / `EMPTY_RECORDING` / `FINALIZE_IN_FLIGHT` (shared flag with note finalize).
- Consumes: existing `transcribeWavForFinalize`, `orch.exposedSegments`/`setFinalizeSegments`/`wavPath`/`language`, `createSessionDump`, the `finalizeInFlight` flag in `registerSessionFinalize`, and the session-clear in `onSessionSettled` (ipc.ts).

- [ ] **Step 1 — Re-read the live code first.** Read `session-finalize.ts` (the `registerSessionFinalize` handlers + `SessionFinalizeDeps` + `SessionSettleResult`), and `ipc.ts` lines ~232-258 (`transcribeWavForFinalize`), ~355-443 (`getCurrentSession` steps A-D), and the `onSessionSettled` callback (the session-clear-on-success + LLM-idle-unload + dump-error block). Confirm exact names/shape before editing.

- [ ] **Step 2 — Write the failing tests** in `ipc.test.ts` (mirror the existing C3 `session/finalize` harness — it already stubs `app.getPath`, a fake supervisor/client, and a fake STT whose `transcribeFile` resolves a known segment list). Add a `describe('session/transcribe (raw transcript)')`:
  - returns the transcribed segments + `language` + `durationSec` (= last segment `endSec`);
  - does NOT call `llm.loadModel` (assert the LLM load mock is never invoked — the whole point);
  - reuses the orchestrator transcript cache: when `exposedSegments` is already populated, `transcribeFile` is NOT called again;
  - writes `transcript.json` to the dump dir with the real segments;
  - `EMPTY_RECORDING` when `transcribeFile` resolves `[]`; `WAV_MISSING` when `orch.wavPath` is null/missing;
  - shares `finalizeInFlight` with `session/finalize` (a concurrent call rejects `FINALIZE_IN_FLIGHT`);
  - clears the live session on success (a subsequent `session/start` is NOT rejected `SESSION_ACTIVE`); preserves it on failure.

- [ ] **Step 3 — Run; verify FAIL:** `pnpm --filter @lisna/desktop exec vitest run src/main/__tests__/ipc.test.ts`.

- [ ] **Step 4 — Implement:**
  - `ipc-protocol.ts`: add the `SessionTranscribeResult` interface (import `TranscriptSegment` from `./types`, already imported).
  - `session-finalize.ts`:
    - `export const SESSION_TRANSCRIBE_CHANNEL = 'session/transcribe' as const;`
    - `SessionFinalizeDeps`: add `getTranscript?: () => Promise<SessionTranscribeResult>;` (import the type).
    - Extend `SessionSettleResult` with `| { ok: true; kind: 'transcript' } | { ok: false; kind: 'transcript'; error: string }`.
    - Register a `SESSION_TRANSCRIBE_CHANNEL` handler INSIDE `registerSessionFinalize` (so it shares `finalizeInFlight`): guard `FINALIZE_IN_FLIGHT`; `if (!deps.getTranscript) throw new Error('TRANSCRIBE_UNAVAILABLE')`; in try → `const r = await deps.getTranscript(); settle = { ok:true, kind:'transcript' }; return r;`; catch → `settle = { ok:false, kind:'transcript', error }`, rethrow; finally → `finalizeInFlight = false; deps.onSessionSettled?.(settle);`.
  - `ipc.ts`:
    - Add `sessionTranscribe: 'session/transcribe'` to `CHANNELS` (cross-ref the const).
    - Wire `getTranscript` in the `registerSessionFinalize({...})` deps: resolve `current`/`paths`/`client` exactly like `getCurrentSession`'s preamble (return-by-throw `NO_ACTIVE_SESSION` if `!current`); then mirror steps **A-D only**: create the dump (`_activeDump = createSessionDump(...)`); if `orch.exposedSegments.length === 0` → `WAV_MISSING` guard then `transcribeWavForFinalize` + `setFinalizeSegments`; `EMPTY_RECORDING` guard; write `transcript.json`. Return `{ sessionId:'live', language: orch.language, segments: orch.exposedSegments, durationSec: lastEndSec(orch.exposedSegments) }`. **Do NOT load the LLM.**
    - In `onSessionSettled`: handle the transcript settle variant — on `ok` run the SAME live-session clear as a note success (clear `current`/`_llmLoadedForCurrent`/`recording`, re-arm idle-stop); the LLM idle-unload it performs is a harmless no-op (no LLM loaded). On `!ok` write the dump error (reuse the existing `_activeDump` error write) and PRESERVE the session. Do NOT write a note `result.json` for the transcript variant (there is no note).
  - `preload/index.ts`: add `transcribeOnly: (): Promise<SessionTranscribeResult> => ipcRenderer.invoke(CHANNELS.sessionTranscribe)` + the `Window.lisna` decl line. Import `SessionTranscribeResult`.

- [ ] **Step 5 — Run; verify PASS** + `typecheck` + `lint`.

- [ ] **Step 6 — Stage + STOP** (no commit): `git add desktop/src/shared/ipc-protocol.ts desktop/src/main/sidecar/ipc/session-finalize.ts desktop/src/main/ipc.ts desktop/src/preload/index.ts desktop/src/main/__tests__/ipc.test.ts`. Report the staged tree SHA. Zombie scan.

---

### Task 2: `TranscriptView` component

**Files:**
- Create: `desktop/src/renderer/routes/TranscriptView.tsx`
- Create: `desktop/src/renderer/routes/__tests__/TranscriptView.test.tsx`

**Interfaces:**
- Produces: `TranscriptView({ segments, language, durationSec, onNewSession })` — `segments: TranscriptSegment[]` (from `@shared/types`), `language: string`, `durationSec?: number`, `onNewSession: () => void`.

- [ ] **Step 1 — Write the failing test** (`renderToStaticMarkup`, mirror `ErrorView.test.tsx` — vitest has no DOM env):
  - renders one line per segment formatted `[m:ss] <text>` where `m:ss` derives from `startSec` (e.g. `startSec:63` → `[1:03]`);
  - renders a 新しい録音 button (`data-testid="transcript-new-session"`);
  - shows a header with the segment count (and `durationSec` formatted m:ss when present).

- [ ] **Step 2 — Run; verify FAIL:** `pnpm --filter @lisna/desktop exec vitest run src/renderer/routes/__tests__/TranscriptView.test.tsx`.

- [ ] **Step 3 — Implement** `TranscriptView.tsx`: a `<section>` with an `<h2>文字起こし</h2>`, a small header line (`{segments.length} 個のセグメント` + the formatted duration), a scrollable `<ul>` of monospace `[m:ss] text` lines (key by index; `m:ss` via a local `fmt(sec)` helper = `${Math.floor(sec/60)}:${String(Math.floor(sec%60)).padStart(2,'0')}`), and a 新しい録音 `<button data-testid="transcript-new-session" onClick={onNewSession}>`. Inline styles consistent with `ErrorView.tsx`/`Recording.tsx`; no legal-pad decoration.

- [ ] **Step 4 — Run; verify PASS** + `typecheck` + `lint`.

- [ ] **Step 5 — Stage + STOP:** `git add desktop/src/renderer/routes/TranscriptView.tsx desktop/src/renderer/routes/__tests__/TranscriptView.test.tsx`. Report tree SHA. Zombie scan.

---

### Task 3: Picker option + App FSM wiring

**Files:**
- Modify: `desktop/src/renderer/components/FamilyPickerStep.tsx` (5th `'transcript'` choice; `onPick` widening)
- Modify: `desktop/src/renderer/components/__tests__/FamilyPickerStep.test.tsx`
- Modify: `desktop/src/renderer/App.tsx` (FSM states + picker branch + `runTranscribe` + render `TranscriptView`)
- Test: also add a focused FSM assertion if a pure helper is extractable (else rely on the picker test + typecheck)

**Interfaces:**
- Consumes: `window.lisna.transcribeOnly()` (Task 1), `TranscriptView` (Task 2).

- [ ] **Step 1 — Re-read** `FamilyPickerStep.tsx` + `App.tsx` (the `View` union, `renderView` `familyPicking`/`note` cases, `runFinalize`). They changed in Group D — confirm current shape.

- [ ] **Step 2 — Write the failing test** in `FamilyPickerStep.test.tsx`: the picker renders a `文字起こし` choice (`data-testid="family-radio-transcript"`); selecting it + 続行 calls `onPick('transcript')`. (Mirror the existing radio/onPick assertions.)

- [ ] **Step 3 — Run; verify FAIL:** `pnpm --filter @lisna/desktop exec vitest run src/renderer/components/__tests__/FamilyPickerStep.test.tsx`.

- [ ] **Step 4 — Implement:**
  - `FamilyPickerStep.tsx`: change `Props.onPick` to `(choice: NoteFamily | 'transcript') => void`; widen the local `selected` state + the `FAMILIES` entry type to `NoteFamily | 'transcript'`. Append a `'transcript'` entry: `label: '文字起こし (Transcript)'`, `desc: '録音をそのまま字幕で表示（ノート生成なし）'`, `disabled: false`. Render it after a subtle separator (e.g. an `<li>` with a top border + a small caption 「またはノートにせず」) so it reads as an alternative output, not a session "type".
  - `App.tsx`:
    - `View` union: add `| { kind: 'transcribing' }` and `| { kind: 'transcript'; segments: TranscriptSegment[]; language: string; durationSec?: number }`. (Re-import `TranscriptSegment` from `@shared/types` — it was dropped in Group D; add it back for these variants.)
    - `familyPicking` case `onPick`: branch — `if (choice === 'transcript') { setView({ kind:'transcribing' }); void runTranscribe(setView); } else { existing note path with choice as NoteFamily }`.
    - Add module-scope `async function runTranscribe(setView)`: `try { const r = await window.lisna.transcribeOnly(); setView({ kind:'transcript', segments:r.segments, language:r.language, durationSec:r.durationSec }); } catch (err) { setView(prev => prev.kind==='error'?prev:{ kind:'error', message:String((err as Error)?.message ?? err) }); }`.
    - `renderView`: add `case 'transcribing':` → a minimal spinner + 「文字起こし中…」 (reuse `Spinner`); `case 'transcript':` → `<TranscriptView segments={view.segments} language={view.language} durationSec={view.durationSec} onNewSession={() => setView({ kind:'recording' })} />`.
    - Import `TranscriptView` + `Spinner`.

- [ ] **Step 5 — Run; verify PASS** (picker test) + `typecheck` + `lint` + re-run the renderer suite touched (`ErrorView.test.tsx`, `finalize-progress-apply.test.ts`, `recording-stop.test.ts`, `TranscriptView.test.tsx`) to confirm no FSM regression.

- [ ] **Step 6 — Stage + STOP:** `git add desktop/src/renderer/components/FamilyPickerStep.tsx desktop/src/renderer/components/__tests__/FamilyPickerStep.test.tsx desktop/src/renderer/App.tsx`. Report tree SHA. Zombie scan.

---

### Task 4: Rebuild + reinstall the app

- [ ] After Tasks 1-3 commit + a final `typecheck`/`lint`/scoped-test sweep is green: `pnpm --filter @lisna/desktop build` → `pnpm --filter @lisna/desktop exec electron-builder --mac --publish never` (sidecar + dylibs already current — no C++ rebuild) → validate (mic entitlement, sidecar+dylibs bundled, codesign --verify) → `ditto` to `/Applications/Lisna.app`. If electron-builder ENOENTs on `backend/node_modules`, `rm -rf backend/node_modules` (orphan from #133). Confirm Lisna not running before the swap.

---

## Self-review (plan vs spec)

- **Spec coverage:** transcribe-only IPC + no-LLM + cache reuse + dump/history → Task 1; `SessionTranscribeResult` → Task 1; preload bridge → Task 1; picker 5th choice + `onPick` widening → Task 3; `TranscriptView` subtitle render → Task 2; FSM `transcribing`/`transcript` → Task 3; error reuse (WAV_MISSING/EMPTY_RECORDING/FINALIZE_IN_FLIGHT) → Task 1; history via transcript.json (no result.json) → Task 1; app rebuild → Task 4. **Non-goals** (no edit/export, no speakers, not a NoteFamily) are constraints, no task.
- **Placeholder scan:** every code step names exact files + concrete edits; "re-read live first" steps are explicit, not hand-waving.
- **Type consistency:** `SessionTranscribeResult` (sessionId/language/segments/durationSec) identical across Task 1 (produce) + Task 3 (consume); `onPick(NoteFamily | 'transcript')` consistent picker↔App; `runTranscribe(setView)` + the `transcript`/`transcribing` View variants consistent within Task 3.
- **Settle decision (spec soft spot resolved):** transcript success/failure reuses `onSessionSettled` via an extended `SessionSettleResult` transcript variant — clear-on-success / preserve-on-failure, LLM-unload is a no-op, no note `result.json` written.
