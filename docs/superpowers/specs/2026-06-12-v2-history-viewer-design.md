# v2 — Recording History Viewer (F2) (Design)

- **Date**: 2026-06-12
- **Status**: Design APPROVED in founder session 2026-06-12. Spec review pending.
- **Lane**: app-design (renderer) + main-process IPC
- **Origin**: F2 from the 2026-06-11 session (memory
  `v2_track2_v015_interview_diarization_2026-06-11`) — decided as follow-up,
  never implemented. Founder 2026-06-12: core capability for the
  repeat-test loop on note generation.
- **Related**: PR #113 (finalize debug dump — the data source), PR #117
  (F1 retry-from-preserved-transcript — the regenerate machinery),
  `desktop/src/main/session-debug-dump.ts`, `desktop/src/main/ipc.ts`,
  `desktop/src/renderer/App.tsx` + `routes/`.

---

## 1. Purpose

Browse past recordings' transcripts inside the app and regenerate a note
from any of them — no re-recording. Primary consumer: the founder test
loop (e.g., re-running the failed 17-min interview transcript against the
sampler-alignment fix, apples-to-apples). Companion spec:
`2026-06-12-v2-track2-sampler-alignment-design.md`.

## 2. Data source — no new storage

The #113 dump tree is read as-is: `<userData>/sessions/<ts>/` with
`transcript.json` (sessionId, language, llmModel, segments[{startSec,
endSec, text, noSpeechProb?}]) · `llm-calls.ndjson` · `grammar-N.gbnf` ·
`result.json` ({ok, family, note|error}) · `note.json` (success only).
Dir names match `DUMP_DIR_RE` (`session-debug-dump.ts:27`).

- Retention stays newest-20 (`DEFAULT_MAX_SESSIONS`,
  `session-debug-dump.ts:25`). Expanding retention is a non-goal; if the
  test loop needs more, bump the constant — not this feature's concern.
- `LISNA_DISABLE_SESSION_DUMP=1` ⇒ no dumps ⇒ empty history. Documented
  behavior, not an error state.
- Dumps are local-only artifacts consistent with the on-device privacy
  model; the viewer adds no new persistence or network surface.

## 3. IPC (main)

Three additions to `desktop/src/main/ipc.ts` CHANNELS:

1. **`session/listDumps`** → `DumpSummary[]`, newest first:
   `{ id (dir name), recordedAt (parsed from dir name), language,
   llmModel, segmentCount, durationSec (last segment endSec, 0 when
   empty), family?, ok? }`. `language/llmModel/segmentCount/durationSec`
   from `transcript.json`; `family/ok` from `result.json` when present.
   A dir whose `transcript.json` is missing/unparseable yields
   `{ id, recordedAt, unreadable: true }` instead of being dropped —
   the list shows it as unselectable (section 5).
2. **`session/loadDump`** `{ id }` → full `transcript.json` payload.
   `id` MUST match `DUMP_DIR_RE` (path-traversal guard) and resolve to a
   direct child of the sessions base dir.
3. **`session/finalizeFromDump`** `{ id, family }` → same return shape as
   `session/finalize` (`{ noteId, note }`). Internally reuses the F1
   machinery: the same finalize executor `session/finalize` runs
   (LLM lazy-load via `getCurrentSession()` swap, family `finalize*`
   fns, telemetry, #113 dump-wrapping — the rerun produces its OWN new
   dump dir), with the transcript sourced from the dump file instead of
   the preserved in-memory `current`. Family is caller-chosen (F1
   already allows family change). Guard: rejected with a typed error
   while a live session is active (`SESSION_ACTIVE` semantics unchanged).

Reader helpers live next to `session-debug-dump.ts` (same module owns the
dir-shape knowledge; Electron-free with injected baseDir, matching its
existing test pattern).

## 4. Renderer

- **Entry point**: the idle block of
  `desktop/src/renderer/routes/Recording.tsx` gains a History section —
  list of `DumpSummary` rows (time, duration, language, family/status
  badge, llmModel). Empty state: one quiet line ("まだ履歴がありません" /
  EN equivalent per existing UI language convention).
- **New route** `desktop/src/renderer/routes/History.tsx` + App.tsx View
  union gains `{ kind: 'history'; id: string }`: read-only transcript
  view (reuse the segment-list rendering style already in Recording),
  family picker (reuse `FamilyPickerStep`), [ノートを再生成] button →
  `window.lisna.finalizeFromDump` (preload exposure mirrors the existing
  `window.lisna.finalize` pattern; same for `listDumps`/`loadDump`) →
  joins the existing
  `curatingV2 → note` flow (`NoteRenderProgress`, `NoteView`) unchanged.
  Failure joins `ErrorView` unchanged (F1 retry buttons included).
- Back navigation: History → idle Recording; regenerated note's existing
  close path returns to idle Recording.
- Work-surface rules apply (web-design.md scope-boundary): tokens only,
  no legal-pad decoration.

## 5. Error handling

- Unreadable dump (missing/corrupt `transcript.json`): listed as
  "読み込み不可", not clickable. Never throws the list.
- `finalizeFromDump` failures surface through the existing finalize error
  path (ErrorView + F1 retry) — no new error UI.
- Concurrent-session guard per section 3 item 3.

## 6. Non-goals (v1)

- **Saved-note re-viewing.** Corrected fact vs the approved sketch:
  `note.json` IS the validated post-decode note (not raw text), so
  re-viewing is a cheap follow-up (`loadNote()` → `NoteView`) — but it
  stays OUT of v1 scope as approved. Forward pointer registered here.
- Search/filter, pagination beyond the 20 retained dumps.
- Sampling-knob UI (sweeps are the eval rig's job).
- Retention policy changes; dump schema changes.

## 7. Testing

- `listDumps`/`loadDump` unit tests over fixture dump dirs (tmp baseDir,
  Electron-free — same pattern as existing `session-debug-dump`
  lifecycle tests): happy path, unreadable dir, empty base, id-guard
  rejection (traversal attempt), ordering.
- `finalizeFromDump` routing unit test: dump transcript reaches the
  finalize executor; SESSION_ACTIVE guard; return shape parity with
  `session/finalize`.
- Renderer: FSM transition tests (idle → history → curatingV2 → note;
  error path), History list render states (rows / unreadable / empty).
- Per `testing.md`: no new backend routes, no curator prompt branches —
  no fixture/baseline additions needed.

## 8. Acceptance gate

1. Dev app shows existing real dumps in the History section.
2. Selecting a dump → transcript renders → family picked → regenerate →
   NoteView, end-to-end (mock-sidecar path in CI; real-3B on founder
   machine).
3. Regeneration failure lands in ErrorView with F1 retry available.
4. `pnpm --filter @lisna/desktop verify` green.
5. Desktop version bump per `artifact-version-bump` rides the
   implementing PR.

## 9. Sequencing

Executes BEFORE the sampler-alignment plan (founder decision 2026-06-12):
small, unblocks the repeat-test loop, and gives the sampler fix its
apples-to-apples verification vehicle in-app. Both plans authored
together off this design session; SDD runs viewer first.
