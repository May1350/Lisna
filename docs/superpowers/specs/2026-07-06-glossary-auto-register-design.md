# Auto-register glossary terms from transcript edits — design

**Date:** 2026-07-06
**Status:** approved (design), pending implementation
**Extends:** #155 / 0.1.34 (`suggestGlossaryTerms` + `GlossarySuggestions` confirm banner). Same proven loop — transcript correction → glossary → next recording's STT `initial_prompt` bias (CER 15.8%→0% for registered terms).

## Goal

Make the self-improvement loop **automatic + low-friction**: when a user edits a transcript, the corrected proper nouns are **registered to the glossary immediately** (no confirm tap), and a **persistent, reversible banner** shows what was added so the user can undo any wrong one. The next recording's STT then biases toward those spellings (unchanged Loop A).

## Non-goals

- **Note-body editing** — notes are LLM-generated structured JSON (read-only); making them editable is a separate, larger project (explicitly out per the founder's scope choice + the 2026-06-27 personalization-mvp de-scope).
- **Changing the extractor** — `suggestGlossaryTerms` / `extractProperNounRuns` (katakana ≥2 + Latin/product runs new in the edit, minus existing, cap 12) is high-precision and stays as-is. It is what keeps auto-add safe.
- **Glossary → note-generation LLM** — glossary remains STT-only (`initial_prompt`). Unchanged.

## Behavior

On transcript edit-save at BOTH sites (`TranscriptView` live + `History` detail), after `saveTranscript` succeeds:
1. Build `before/after` pairs from changed segments (existing code).
2. `autoRegisterGlossaryFromEdit(pairs, deps)` → runs `suggestGlossaryTerms(pairs, existing)`; if it yields terms, `setGlossary([...existing, ...terms])` (append) and returns the terms actually persisted; else returns `[]`.
3. If ≥1 term registered → render the **added banner** (persistent until dismissed) with those terms.
4. If 0 terms → nothing (silent — no banner).

**Added banner** (the flipped `GlossarySuggestions`): heading 「以下を用語集に追加しました」 + sub 「次回以降の文字起こしがこの表記に寄ります。」; each term a chip with an **✕ remove** control; a 「すべて取り消す」 (remove all) button; a 「閉じる」 button. Persistent (renders in-flow below the transcript until closed or navigation) — matches the founder's "계속 떠 있는" choice.
- **Remove(term):** `getGlossary()` → `setGlossary(current.filter(t => t !== term))` → mark that chip removed locally (strikethrough/greyed). Reversible per-term + all.
- Write failures (rare disk/IPC) are best-effort: the transcript edit is already saved; on a failed `setGlossary`, don't claim the term was added (show only terms confirmed in the returned saved list; if the append throws, show no banner).

### Risk + mitigation
A wrong glossary term biases FUTURE STT incorrectly (why #155 used confirm). Mitigated by: (a) the extractor is high-precision — only proper-noun-shaped tokens the user newly typed; (b) the banner surfaces exactly what was added with one-tap undo; (c) 64-term cap + `TermsView` full CRUD remain as the backstop. Net: automatic convenience + transparency + reversibility.

## Architecture (files)

- `desktop/src/renderer/lib/glossary-auto.ts` (new) — `autoRegisterGlossaryFromEdit(pairs, deps: { getGlossary, setGlossary }): Promise<string[]>` (returns terms added). Pure-ish, deps injected for tests. This is the testable seam (renderer package has no DOM env → logic lives in a plain module, not the component).
- `desktop/src/renderer/components/GlossarySuggestions.tsx` → flipped to the **added + undo** banner (rename to `GlossaryAdded` for accuracy; update the 2 import sites). Props `{ added: string[]; onClose }`; remove via injected/`window.lisna` glossary IPC.
- `desktop/src/renderer/routes/TranscriptView.tsx` — save handler calls `autoRegisterGlossaryFromEdit`; on non-empty, set `added` state + render the banner (replaces the current `suggestions`/`GlossarySuggestions` confirm path).
- `desktop/src/renderer/routes/History.tsx` — same.
- `desktop/src/shared/stt/glossary.ts` — UNCHANGED (extractor/normalize/buildInitialPrompt). Save path (`glossary-store.ts`, `glossary/get`+`glossary/set` IPC) UNCHANGED.
- `desktop/package.json` — version 0.1.38 → 0.1.39.

## Testing

- `autoRegisterGlossaryFromEdit` (unit, injected `getGlossary`/`setGlossary` mocks): pairs with a new proper noun → calls `setGlossary` with existing+term, returns `[term]`; pairs with no new proper noun → no `setGlossary` call, returns `[]`; already-glossed term → not re-added; `setGlossary` throws → returns `[]` (best-effort, no throw escapes).
- `GlossaryAdded` banner (`renderToStaticMarkup`): renders the added terms + a remove affordance (✕) + 「すべて取り消す」 + heading 「追加しました」; empty `added` → renders nothing.
- `suggestGlossaryTerms` existing 12 tests stay green (extractor unchanged).
- Live remove-interaction verified in-app (rebuild), not unit-tested.

## Delivery

Branch `feat/glossary-auto-register` (off `feat/onboarding-redesign` 0.1.38). SDD (TDD + independent review, same gate flow) → 0.1.39 → rebuild `/Applications/Lisna.app` → founder smokes: edit a transcript proper noun → banner says "added" → next recording biases. Then push. (Stack note: onboarding→#156→#155→main is already deep; consolidate at merge time.)
