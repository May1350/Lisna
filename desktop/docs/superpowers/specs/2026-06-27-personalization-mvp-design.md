# On-Device Personalization MVP — Design Spec

**Date:** 2026-06-27 · **Status:** approved-for-impl · **Branch:** `feat/v2-personalization-mvp`

## 0. Origin & gate

Founder vision: *"user edits the note/transcript in-app OR supplies input → STT + notes optimize for that user, on-device."* A critical, adversarially-verified feasibility assessment (`tasks/wtjofc2oq.output`, 2026-06-26) graded it **OK-but-de-scoped**: ship only what rides **proven acoustic / deterministic channels** (model-obedience-independent); cut everything that bets on the 3B obeying injected free text. Founder **agreed** to the de-scope.

This MVP is the SHIPS tier. It is honestly framed as **"pin your team's terms + correct the transcript locally"**, NOT "the app learns me."

## 1. Scope

### In (this spec)
1. **Local context store** — a crash-safe `<userData>/glossary.json` with a write path (read path already exists).
2. **Terms UI** — a screen to view / add / remove glossary terms (the proper-noun list that biases STT).
3. **Editable transcript** — edit segment text in `TranscriptView` and persist it locally to the session's `transcript.json`.

### Explicitly OUT (non-goals — do not build)
- Note-**style** personalization via prompt text (the 3B ignores/­inverts injected behavioral instructions — reproduced). The visible note structure is deterministic `assemble.ts` templates the LLM never sees.
- Few-shot retrieval from past notes (no retrieval substrate; a sentence encoder is a 3rd resident model the 8GB budget forbids; exemplars re-inflate prefill into the kernel-panic zone).
- On-device fine-tuning.
- **Auto-extracting glossary terms from a transcript edit** (STRETCH — gated on a separate empirical test; the MVP transcript edit only persists locally, it does NOT auto-populate the glossary).

## 2. The loop (what actually improves)

```
USER ACTION (in-app)              LOCAL STORE                 EFFECT (next time)
──────────────────                ───────────                 ──────────────────
Terms UI: add "カスタマーループ"  →  glossary.json (terms[])  →  STT initial_prompt biases
                                                                 toward that exact spelling
Transcript: fix a segment      →  that session's            →  corrected transcript persists;
                                  transcript.json               re-open / re-export shows the fix
```

The STT read path is **already wired** end-to-end (`glossary.ts` → `loadGlossaryInitialPrompt` in `ipc.ts:235` → `whisper_engine.cpp` `p.initial_prompt`). This MVP adds the **write** side + the UI.

**Honest ceiling (state in UI copy):** the glossary pins the EXACT spelling supplied (measured: katakana `センドグリッド` in glossary → CER 15.8%→0%). It does **NOT** fix acoustic homophones (`四半期`/`市販機`, `恒久`/`高級` persist even when glossed) and is form-sensitive (English `SendGrid` ≠ katakana output). Copy must say "pin the spelling of names/jargon," not "fixes transcription."

## 3. Component C1 — local context store

**File:** `src/shared/stt/glossary.ts` (extend; keep PURE — no fs) + a new main-side writer.

- Add `MAX_GLOSSARY_TERMS = 64` and `MAX_TERM_LEN = 40`. Rationale: Whisper truncates `initial_prompt` to ~224 tokens, so an unbounded list silently drops its head; cap keeps the whole list effective + bounds the file.
- Add `normalizeGlossary(terms: string[]): string[]` (PURE): trim, drop empty, drop > MAX_TERM_LEN, de-dupe (first wins, case-sensitive — JA is case-irrelevant but product names like "iOS" matter), cap to MAX_GLOSSARY_TERMS. Returns the cleaned list.
- **New shared atomic writer `src/main/atomic-json.ts`** — `saveModelsJson` is NOT directly reusable (it hardcodes `models.json`/`ModelsJson` and rides the model-resolver module-global `serializeWrite` chain). Extract its 4-step body into a generic `atomicWriteJson(dir, filename, value): Promise<void>`: write `<filename>.tmp` → `fsync` the file fd → POSIX `rename(.tmp → final)` → **`fsync` the directory fd** (the last step is load-bearing for crash-safety and is test-pinned for models.json — do NOT drop it on extraction). Serialize **per-file** (a small per-path promise chain or a fresh mutex), NOT the model-resolver global chain — glossary/transcript writes must not couple to model-pick writes. Then refactor `saveModelsJson` to call `atomicWriteJson(dir, 'models.json', content)` so the existing models.json crash-safety tests cover the shared helper too.
- Main-side `glossary-store.ts`:
  - `loadGlossary(userDataDir): string[]` — read `<userData>/glossary.json`, `parseGlossary` (exists), fail-soft to `[]` on missing/corrupt (mirror `loadGlossaryInitialPrompt`'s try/catch). **Also unlink an orphan `glossary.json.tmp` on load** (mirror `loadModelsJson` at `model-resolver.ts:90` — crash-recovery hygiene).
  - `saveGlossary(userDataDir, terms): Promise<void>` — `atomicWriteJson(userDataDir, 'glossary.json', normalizeGlossary(terms))`. **NEVER `writeFileSync`** — this machine has force-quit/panicked mid-op.
- `loadGlossaryInitialPrompt` (ipc.ts) is unchanged — it already reads the same file. After a save, the next transcribe picks up the new terms (it reads on the hot finalize path each call; that's existing behavior).

**Acceptance:** corrupt `glossary.json` → `loadGlossary` returns `[]`, app unaffected. A save then load round-trips the normalized list. A kill mid-save leaves either the old file or the new file, never a partial (atomic).

## 4. Component C2 — Terms UI

**New view** `{ kind: 'terms' }` in `App.tsx`'s `View` union + a `TermsView.tsx` route.

- **Entry point:** a "用語集" (Terms) button on the **recording** (home) screen — small, secondary, top-corner. Returns to recording on back.
- **TermsView**: loads terms via `window.lisna.getGlossary()`; renders a list with a remove (×) per term + an "add term" input (Enter or button). Each mutation calls `setGlossary(nextTerms)` (full-list save — simplest, the list is ≤64) and updates local state optimistically. Shows the honest one-liner: *"録音で出てくる固有名詞・専門用語を、出したい表記で登録します。次回以降の文字起こしがこの表記に寄ります。"*
- **Styling:** work-surface / function-first per `web-design.md` scope boundary — inline styles like `TranscriptView`/`CopyExportButtons`. NO legal-pad/`.postit`/`.pencil` decoration. JA copy (v2.0 concept-lock). Distinct, clean, accessible (label the input, focus ring, ≥44px tap targets).
- **IPC** (`ipc.ts` + preload):
  - `glossary/get` → `loadGlossary(userData)` → `string[]`.
  - `glossary/set` `{ terms: string[] }` → `saveGlossary` → returns the normalized `string[]` (so the UI reflects dedupe/cap).

**Acceptance:** add a term → it appears + persists (verify file). Remove → gone + persists. Add a 65th term or a dup → UI reflects the normalized result (cap/dedupe). Reopen app → terms still there.

## 5. Component C3 — editable transcript

**`TranscriptView.tsx`** gains an edit affordance; edits persist to the **session's `transcript.json`**.

- **Persist target & id threading (the tricky part — verified feasible, with a gating edge case):** the persist target is the dump dir's `transcript.json` (written by `writeTranscript`, read by `session-dump-reader`). The id IS available on the live path: `getTranscript` creates `_activeDump = createSessionDump(...)` and `path.basename(_activeDump.dir)` is the `<ts>` id (distinct from `sessionId`, which is hardcoded `'live'` — thread the **dump dir id**, NOT `sessionId`).
  - **EDGE CASE (gating):** `createSessionDump` returns `null` when `LISNA_DISABLE_SESSION_DUMP=1` OR the dir can't be created → then there is NO `transcript.json` and NO id. So `SessionTranscribeResult.dumpId` is `string | undefined`, and the dump-load (History) path supplies its own id. The transcript View carries `dumpId?: string`. **When `dumpId` is undefined, the 編集 affordance is HIDDEN — the transcript is view-only** (persistence requires a dump). The history/loadDump path always has an id, so editing from History always works.
  - New IPC `transcript/save` `{ id: string, segments: {startSec,endSec,text}[] }` → main validates id via **`resolveDumpDir`** (`session-dump-reader.ts` realpath-parent check — NOT the bare `DUMP_DIR_RE` regex, which doesn't stop symlink traversal) → re-reads `transcript.json` → **merges edited text into the re-read segments BY INDEX** (preserves passthrough fields like `noSpeechProb` — do not drop them) → recompute `segmentCount`, keep `durationSec` exactly (timestamps never edited) → `atomicWriteJson`. Returns `{ ok }`.
- **Two writers, by design (do NOT unify):** `writeTranscript` (transcribe time) uses non-atomic `writeFileSync` (best-effort debug dump); `transcript/save` (edit time) uses `atomicWriteJson`. They don't race (transcribe completes before the view renders). Keep them separate — do NOT route the hot finalize path through the serialized atomic writer.
- **UI:** an "編集" toggle on `TranscriptView` (only when `dumpId != null`). In edit mode each segment's text becomes an editable field (auto-size `<textarea>`); "保存" commits via `transcript/save` + exits edit mode; "キャンセル" reverts. Timestamps read-only. The existing コピー/保存(export) buttons reflect the edited text after save.
- **Scope guard:** editing changes `text` only (not timestamps/segment count). No segment add/delete in the MVP.
- **History-edit DEFERRED (fast-follow, reconciled post-review):** the editable surface ships on the LIVE transcribe-only path (which carries the `dumpId`). The History detail view (`HistoryDetail`) renders the transcript read-only + a note-regenerate picker; routing it to the editable view is a separate UI entry point. The data layer (`saveTranscriptEdit` + `resolveDumpDir`) already supports editing ANY valid dump id, so this is purely a missing entry point. Because a live-path edit persists to the same `transcript.json`, re-opening that session from History shows the corrected text (read-only) — the persistence loop is intact; only *initiating* an edit from History is deferred.

**Acceptance:** edit a segment, 保存 → reopen from History → the edit persists; `noSpeechProb` survives. Kill mid-save → atomic (no partial). Copy/export after edit reflects the new text. Path-traversal/symlink id rejected by `resolveDumpDir`. With `LISNA_DISABLE_SESSION_DUMP=1` → result has no `dumpId` → edit affordance hidden (view-only), no crash.

## 6. Cross-cutting

- **Privacy:** everything is `<userData>`-local. No network. Reinforces the locked concept (transcript = conversation content, stays on device).
- **Retention ceiling (accepted for MVP):** `transcript.json` lives in the debug-dump tree, which `pruneOldDumps(..., 20)` trims to the newest 20 sessions on each new finalize/transcribe. So an edited transcript is deletable after ~20 more sessions. ACCEPTED for the MVP (don't touch the prune); the §2 loop copy must not over-promise permanence — frame transcript edits as "correct this transcript," not "permanent archive." (A dedicated durable note/transcript store is a later concern.)
- **No regressions:** the note pipeline, finalize, history viewer, copy/export are untouched except the additive `transcript/save` + the id threading. `loadGlossaryInitialPrompt` behavior is unchanged when the glossary is empty (byte-identical to today).
- **Preload type lockstep:** every new `window.lisna.*` bridge fn must be added to BOTH the `contextBridge.exposeInMainWorld` object AND the `declare global { interface Window { lisna: {...} } }` block in `preload/index.ts`, or renderer calls won't type-check (the `file/export` addition is the template).
- **Version:** confirm `desktop/package.json` is at `0.1.14` (it is, after the copy/export feature), then patch-bump `→ 0.1.15` on the last commit of the feature.

## 7. Test plan

- **Unit (vitest, scoped):** `normalizeGlossary` (trim/dedupe/cap/len); `atomicWriteJson` (round-trip + the models.json crash-safety tests still pass post-extraction); `loadGlossary`/`saveGlossary` round-trip + corrupt-file fail-soft + orphan-`.tmp` cleanup; `transcript/save` segment-merge-by-index (`noSpeechProb` preserved) + `resolveDumpDir` id validation (reject traversal + symlink) + **dumps-disabled path** (no `dumpId` → edit hidden, save not reachable). Pure + fs-on-temp — no LLM, safe on 8GB.
- **Renderer:** TermsView add/remove logic + TranscriptView edit/save/cancel state (logic-level; the project has no jsdom, so test the reducers/handlers, not render — mirror existing renderer tests).
- **Hands-on (final gate, in the rebuilt app):** (1) add real terms in Terms UI → record a clip with those names → confirm the transcript uses the registered spelling (the loop works end-to-end); (2) edit a transcript segment → reopen from History → edit persists; (3) corrupt/kill resilience smoke. Per the UI-verify rule, capture the rendered screens.

## 8. Phasing (PRs)

One cohesive feature, but reviewable in 2 commits/PRs if large:
- **PR-A:** C1 context store + C2 Terms UI (glossary write + UI). Self-contained STT win.
- **PR-B:** C3 editable transcript (id threading + transcript/save + edit UI).

Each: TDD where logic, independent review, scoped tests, version bump on the last.

## 9. Risks

- **id threading** (C3) is the only non-trivial integration — the transcribe/dump result must reliably carry the dump id. Verify the id is the `<sessions>/<ts>` dir name and survives both the live-transcribe and history-load paths.
- **Over-promising in copy** — the UI must state the honest ceiling (spelling pin, not magic). Reviewer checks copy.
- **Atomic write correctness** — reuse `saveModelsJson` verbatim-pattern; do not hand-roll. Test the kill-mid-save case on a temp dir.
