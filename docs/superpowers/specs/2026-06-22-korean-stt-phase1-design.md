# Korean STT — Phase 1 (transcription-only) design

**Date:** 2026-06-22
**Status:** approved (brainstorming) → spec-reviewed + re-baselined → ready for implementation plan
**Base branch:** `feat/stt-finalize-transcription` (PR #134, the record-then-transcribe work + current v0.1.10 app). **NOT `main`** — main lacks the raw-transcript output mode this phase depends on. Founder chose to stack Korean STT on #134.
**Scope decision:** phased — transcription first; structured notes deferred to Phase 2 behind an eval gate.

> Re-baseline note: an earlier draft was written against `main` and was wrong on
> several load-bearing points (independent spec review, 2026-06-22). This version
> is verified against `feat/stt-finalize-transcription` HEAD `2529f6b`. Corrections
> folded in: the transcript mode exists here (not on main); `ko` already routes to
> a *Korean* prompt via `prompts.ts` (there is no `meeting-extract.ts`/`isJa` on
> this branch — that is the parallel #135 note-quality work); the sidecar does NOT
> allowlist `ja`/`en`; `dump-finalize-context.ts` is a note-only path and must be
> left gating `ko`.

## Problem / goal

Lisna desktop supports Japanese (`ja`) and English (`en`) end to end. The founder
wants **Korean (`ko`) voice STT**. The pipeline is largely language-parametric, but
`ko` is blocked at the entry gate, and the central risk is unproven:

- **Central risk:** the on-device 3B Llama's Korean *note-generation* quality is
  unproven. Whisper transcription is low-risk (the shipped `large-v3-turbo` model is
  multilingual); structured-note *synthesis* on a 3B is the open question — the same
  class of problem the JA note-quality loop addressed.

**Concept-yardstick note:** `docs/PRD.md` is explicitly Japan-first ("Japanese market
first because the language + workplace combination is where the competitive slot is
least contested"); Korean is not in PRD scope. This is a founder-directed scope
expansion, flagged and accepted.

## Decision: phased

- **Phase 1 (this spec):** Korean Whisper transcription + the existing raw-transcript
  output mode (`session/transcribe` → `TranscriptView`). **No** structured notes for `ko`.
- **Phase 2 (separate spec, founder-gated):** measure 3B Korean note quality via an
  eval spike; wire `ko` note generation only if it clears a quality bar. (`ko` already
  has a Korean prompt override in `prompts.ts`, but it is **un-eval'd** — that is the
  thing Phase 2 must measure, not a broken path.)

Rationale: de-risks the unproven 3B-Korean-note quality the same way the JA loop did,
ships Korean transcription now, and keeps `ko` off the un-eval'd note path until proven.

## Current state (verified against `feat/stt-finalize-transcription` @ `2529f6b`)

| Area | File:line | Today | Phase-1 change |
|---|---|---|---|
| Language enum | `src/shared/note-schema/base.ts:37` | `z.enum(['ja','en','ko'])`; `Language` (`shared/types.ts`) also has `ko`/`zh` | none |
| **Entry gate** | `src/main/ipc.ts:771` (`sessionStart`) | `if (language !== 'ja' && language !== 'en') throw 'UNSUPPORTED_LANGUAGE'` — the SINGLE entry; recording (and therefore both finalize-note and transcribe) starts here | allow `ko` |
| Transcribe handler | `src/main/ipc.ts` (`CHANNELS.sessionTranscribe` = `session/transcribe`) | no own language gate — uses the language set at `sessionStart` | none (rides the gate change) |
| **Note finalize** | `src/main/ipc.ts` (`session/finalize`, family path) | currently never sees `ko` (blocked upstream) | **add a guard: reject a note-family finalize when language is `ko`** (defense-in-depth behind the picker UX) |
| Regenerate→note gate | `src/main/dump-finalize-context.ts:44` | rejects non-`ja`/`en` — this is the **note-only** history-regenerate path | **leave as-is** (keeps `ko` notes deferred; do NOT touch) |
| STT engine | `src/main/engines/whisper-cpp-stt.ts:13-21` | `loadModel(path, language)` sends `{type:'load',kind:'stt',path,language}` to the sidecar | pass `ko` |
| Sidecar whisper | `desktop/sidecar/src/stt/whisper_engine.cpp`, `ipc/json_protocol.cpp` | **no `ja`/`en` allowlist** — validates non-empty string, sets `whisper_full.language` verbatim (`auto` if empty); `large-v3-turbo` supports Korean | none — `ko` passes cleanly (verified) |
| STT model | `src/shared/models/catalog.ts:30-38` | single multilingual `large-v3-turbo` (`ggml-large-v3-turbo-q5_0.bin`); kotoba removed; "no single language" | none — no model guard |
| Hallucination blocklist | `src/main/engines/segment-filters.ts:17` | already has `ko: new Set()` + `zh: new Set()`; `?? new Set()` fallback | none (already present) |
| Language picker | `src/renderer/routes/Recording.tsx:49,233,243` | `ja`/`en` radios; `localStorage('lisna.language')`; **read coerces non-`'en'` → `'ja'`** | add `ko`/`한국어` radio; **fix the line-49 coercion** so persisted `ko` survives reload |
| Output-mode picker | `src/renderer/components/FamilyPickerStep.tsx` (post-Stop; `App.tsx:308`) | `PickChoice = NoteFamily \| 'transcript'`; `showTranscript` prop (default true); does NOT receive `language` | thread session `language` in; when `ko`, render **only** the `transcript` choice + "Korean structured notes coming soon" hint |
| Transcript view | `src/renderer/routes/TranscriptView.tsx`; `App.tsx:50` `View {kind:'transcript', segments, language}` | exists; language-agnostic | none |

## Phase-1 components & changes

1. **`languageCapabilities(lang)` seam** — one small helper (shared) returning
   `{ transcript: boolean; notes: boolean }`. `ja`/`en` → both true; `ko` →
   `{ transcript: true, notes: false }`. Consumed by the entry gate, the finalize
   guard, and the renderer so the `ja|en|ko` policy lives in ONE place and Phase 2 is
   a one-line flip (`ko.notes = true`).
2. **Entry gate (`ipc.ts:771`)** — accept `ko` (allow start when `transcript || notes`).
   Still reject truly unknown codes.
3. **Note-finalize guard** — in the family `session/finalize` path, reject when
   `!languageCapabilities(lang).notes` (i.e. `ko`) with a clear code. Defense-in-depth
   behind the picker UX so a `ko` structured note can't be produced in Phase 1.
   `dump-finalize-context.ts:44` already enforces the same for the regenerate path —
   leave it.
4. **Whisper Korean** — pass `ko` through `whisper-cpp-stt.ts` → sidecar →
   `whisper_full.language = "ko"`. No model change.
5. **Language picker (`Recording.tsx`)** — add a `한국어`/`ko` radio; fix the line-49
   `localStorage` read so `ko` isn't coerced back to `ja` on reload
   (`get(...) === 'en' ? 'en' : 'ja'` → handle `'ko'`).
6. **`ko` → transcript-only UX (`FamilyPickerStep`)** — thread session `language` in;
   when `!notes(lang)`, show only the `transcript` choice + hint. Keeps `ko` off the
   note path at the UI; the finalize guard (3) is the server-side backstop.
7. **Error i18n (`error-message-map.ts`)** — ensure any code a `ko` session can hit
   (`UNSUPPORTED_LANGUAGE`, a new "ko notes not yet" code, `EMPTY_RECORDING`) has sane
   JA/EN copy. No note-only error should be reachable on the `ko` transcript path.

## Phase 2 (deferred — separate spec, founder gate)

- Build a Korean note eval fixture (Korean meeting/lecture transcript + gold) under
  `desktop/eval/fixtures/`.
- Run the offline-3b loop (`scripts/note-loop-run.ts`, FOREGROUND/zombie-kill) to
  measure the existing `ko` Korean-prompt-override note quality (coverage, groundingKo,
  language-flip).
- Decide: ship `ko` notes (flip `languageCapabilities('ko').notes`) / tune `ko` prompts /
  require a larger on-device model.

## Testing

- **Unit (deterministic, no LLM):**
  - `languageCapabilities`: `ja`/`en` → notes+transcript; `ko` → transcript-only.
  - entry gate accepts `ko`, rejects unknown codes.
  - finalize guard rejects a `ko` note-family finalize; `session/transcribe` accepts `ko`.
  - `Recording.tsx` renders the `ko` radio AND persists/reloads `ko` (line-49 fix).
  - `FamilyPickerStep` with `language='ko'` renders only the transcript choice.
- **Acceptance (founder-gated — Claude cannot record audio):** founder provides a short
  Korean recording (mic and/or system audio); a corrected reference transcript is
  committed as a CER fixture; Korean transcription must meet an agreed bar. Exact bar
  decided when the recording lands, defaulting to the JA gate's standard
  (proper-noun errors == 0 / a CER margin). Wire the `ko` fixture slot now.

## Out of scope (Phase 1)

- Korean structured notes (all four families) — Phase 2.
- Korean-specific diarization tuning.
- Korean web/marketing i18n (separate `web/` package).
- Korean hallucination-blocklist content (entry already exists, empty; populate from
  real usage).

## Risks

- **Stacked on the unmerged #134.** If #134 changes before it merges, this branch
  rebases. Mitigation: keep Phase 1 small; merge #134 → then this.
- **Korean far-field CER unknown** until the founder records — acceptance is the gate,
  not an assumption.
