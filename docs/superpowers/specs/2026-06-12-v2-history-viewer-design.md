# v2 — Recording History Viewer (F2) (Design)

- **Date**: 2026-06-12
- **Status**: Design APPROVED in founder session 2026-06-12. Expert-reviewed
  same day (independent opus reviewer, APPROVE-WITH-FIXES; P0-1/P0-2/P0-3 +
  P1-1/P1-2 + P2-1/P2-2/P2-3 applied — regen dump-skip, factored shared
  finalize helper, origin-aware retry edge).
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
   llmModel, segmentCount, durationSec, family?, ok? }`.
   `transcript.json` already persists top-level `segmentCount` and
   `durationSec` (`session-debug-dump.ts:103-104`, review P2-2) — prefer
   them, falling back to `segments` only when absent; `language/llmModel`
   from the same file; `family/ok` from `result.json` when present.
   A dir whose `transcript.json` is missing/unparseable yields
   `{ id, recordedAt, unreadable: true }` instead of being dropped —
   the list shows it as unselectable (section 5).
2. **`session/loadDump`** `{ id }` → full `transcript.json` payload.
   `id` MUST match `DUMP_DIR_RE` AND the resolved (realpath) target's
   parent must EQUAL the sessions base dir — resolve-and-compare
   equality, not string prefix (review P1-2). The guard applies to both
   `loadDump` and `finalizeFromDump`; handlers read only the known
   filenames within the dir.
3. **`session/finalizeFromDump`** `{ id, family }` → same return shape as
   `session/finalize` (`{ noteId, note }`). **Corrected per review
   P0-2**: this is NEW plumbing that shares machinery via a factored
   helper — NOT a literal reuse of the `session/finalize` executor. That
   executor is hard-wired to the module-global live session
   (`getCurrentSession()`/`current`, `ipc.ts:228-324`); F1 works by NOT
   clearing `current` on failure, not by transcript injection. The new
   handler: (a) builds its own `SessionContext` from the dump
   (`segments`, `language`, `llmModel`); (b) calls the SAME
   load-and-finalize helper, factored out of `ipc.ts:269-323` (LLM
   lazy-load + recovering-sidecar + family `route*`/`finalize*` dispatch
   + telemetry), so live and from-dump runs traverse an IDENTICAL
   sampler/recovery path — the apples-to-apples property this tool
   exists for; (c) **skips dump-writing for the regen run** (per-call
   flag threaded to the dump-wrap step, NOT the global env var) —
   review P0-1: under newest-20 retention, dumping every regen would
   evict the very source dump under repeated test. Consequence:
   regenerated notes are screen-only (NoteView); persisting them is a
   non-goal alongside saved-note re-viewing (section 6). Family is
   caller-chosen (F1 already allows family change). Guards:
   `SESSION_ACTIVE` typed error while a live session is active, PLUS a
   new main-side `_finalizeInFlight` re-entrancy guard rejecting
   concurrent `finalize`/`finalizeFromDump` with a typed error (review
   P1-1 — `SESSION_ACTIVE` checks only `current` and does not cover
   finalize-vs-finalize).

Reader helpers live next to `session-debug-dump.ts` (same module owns the
dir-shape knowledge; Electron-free with injected baseDir, matching its
existing test pattern).

## 4. Renderer

- **Entry point**: the not-recording state of
  `desktop/src/renderer/routes/Recording.tsx` (`running === false` —
  review P2-1: there is no separate idle component) gains a History
  section —
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
  Failure routes to `ErrorView` with a NEW origin-aware retry edge
  (review P0-3): the error state carries `origin: {kind:'live'} |
  {kind:'dump'; id}`, and retry for dump origin re-dispatches
  `finalizeFromDump({id, family})` — the existing retry edge re-invokes
  the LIVE `session/finalize` against `current` (`App.tsx:283` → `:323`),
  which is null for history regens and would deterministically fail
  `NO_ACTIVE_SESSION`. The regenerate button carries the same
  `submitting` in-flight guard discipline as `FamilyPickerStep`
  (double-fire = two concurrent generate streams over one sidecar).
- Back navigation: History → idle Recording; regenerated note's existing
  close path returns to idle Recording.
- Work-surface rules apply (web-design.md scope-boundary): tokens only,
  no legal-pad decoration.

## 5. Error handling

- Unreadable dump (missing/corrupt `transcript.json`): listed as
  "読み込み不可", not clickable. Never throws the list.
- `finalizeFromDump` failures surface in `ErrorView`; retry re-dispatches
  per the origin-aware edge (section 4) — no new error UI beyond the
  origin field.
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
- `finalizeFromDump` unit tests (review P2-3 — each review defect gets a
  named case): (i) builds `SessionContext` from the dump WITHOUT a live
  `current`, return shape parity with `session/finalize`; (ii) regen run
  writes NO new dump dir — source dump survives repeated regens (P0-1);
  (iii) `SESSION_ACTIVE` + `_finalizeInFlight` re-entrancy rejections
  (P1-1); (iv) id-guard resolve-parent rejection — traversal attempt +
  non-child path (P1-2).
- Renderer: FSM transition tests (idle → history → curatingV2 → note;
  error path INCLUDING dump-origin retry re-dispatching
  `finalizeFromDump`, P0-3), History list render states (rows /
  unreadable / empty).
- Per `testing.md`: no new backend routes, no curator prompt branches —
  no fixture/baseline additions needed.

## 8. Acceptance gate

1. Dev app shows existing real dumps in the History section.
2. Selecting a dump → transcript renders → family picked → regenerate →
   NoteView, end-to-end (mock-sidecar path in CI; real-3B on founder
   machine).
3. Regeneration failure lands in ErrorView and its retry re-runs the DUMP
   regeneration (origin-aware edge), not the live finalize.
4. Repeated regeneration leaves the source dump intact (regen runs write
   no dumps; retention untouched).
5. `pnpm --filter @lisna/desktop verify` green.
6. Desktop version bump per `artifact-version-bump` rides the
   implementing PR.

## 9. Sequencing

Executes BEFORE the sampler-alignment plan (founder decision 2026-06-12):
small, unblocks the repeat-test loop, and gives the sampler fix its
apples-to-apples verification vehicle in-app. Both plans authored
together off this design session; SDD runs viewer first.
