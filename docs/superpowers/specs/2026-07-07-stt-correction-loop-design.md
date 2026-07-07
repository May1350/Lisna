# Language-agnostic STT correction loop

**Date:** 2026-07-07
**Status:** QUEUED — approved direction (founder), starts AFTER LLM connector Phase A ships. Do not implement before then.
**Predecessor:** glossary auto-register (#155/#157, 0.1.39) — this generalizes it.

## 1. Goal (founder, verbatim direction)

"어떤 언어든지 실제 음성과 다르게 자막이 생성된 부분이 있다면 수정해서 등록하고, 그걸로 자막의 품질을 향상시키고 싶어."

Today's extraction is script-based (katakana runs + Latin runs, `desktop/src/shared/stt/glossary.ts:96-98`) → effectively JA+EN only. Hangul and kanji proper nouns are never captured; recurring non-proper-noun mishearings are never fixed.

## 2. Mechanisms — what "improve quality" physically means

On-device Whisper cannot learn. Two levers only:

1. **Pre-STT bias** (exists): glossary terms → `initial_prompt` (~224-token budget, `MAX_GLOSSARY_TERMS` 64). Prevents proper-noun mishearing. Works for any language Whisper supports; only the *extraction* is JA/Latin-limited today.
2. **Post-STT replacement** (new): user-derived correction rules ("STT emitted X → rewrite to Y") applied deterministically after transcription. Language-agnostic; catches recurring mishearings of ANY word (homophones, model quirks). Standard technique (MacWhisper replacement rules).

**Honest limit (set founder expectations):** only *recurring* errors are preventable. A one-off random error is fixed by that one edit and nothing more.

## 3. Design

### 3a. Diff-based span extraction (replaces whole-segment script scan)

From each edit's existing `{before, after}` pair, compute the **minimal changed spans** (word-level diff for spaced languages; character-run diff for JA/KO — exact algorithm chosen at implementation with tests). The user's correction locus IS the signal — no per-script proper-noun heuristics needed. This makes kanji and Hangul terms capturable for free (the current comment "kanji NER is out of reach" is obsoleted: we don't need NER, the user pointed at the term).

Each extracted span pair `(beforeSpan → afterSpan)` feeds two consumers:

### 3b. Consumer 1 — glossary / initial_prompt (existing UX, widened input)

`afterSpan` terms auto-append to the glossary (auto + `GlossaryAdded` banner + per-term undo). Guards unchanged: `MAX_TERM_LEN` 40, dedupe, cap 64, skip if already present. Whitespace/punctuation/pure-hiragana spans dropped.

**Per-script precision gate** (protects the 64-slot / 224-token budget from common-word corrections like 되요→돼요):
- katakana / Latin / kanji-containing spans → register on **first** sighting (name-like with high precision when they appear as a correction locus).
- **Hangul-only spans → register on 2nd sighting** (same recurrence gate as replacement rules). In KO every word is Hangul, so a single edit can't distinguish a proper noun from a spelling fix; recurrence can. The paired replacement rule activates at the same moment, so the fix is not delayed — only the bias is.

### 3c. Consumer 2 — replacement rules (new store + post-STT pass)

- Store: `corrections.json` sibling of the glossary store (`desktop/src/main/glossary-store.ts` pattern): `{ before, after, seenCount, active, createdAt }[]`, capped (128, LRU on inactive).
- **Activation gate:** a rule becomes `active` only when the same `(before → after)` pair is extracted from edits **≥2 times**. First sighting records it inactive. Rationale: a single edit can be stylistic (되요→돼요); recurrence indicates a systematic mishearing worth auto-fixing. Registration shows in the same banner ("치환 규칙: X→Y") with undo.
- Safety guards: `beforeSpan` length ≥2 chars; Latin spans replace on word boundaries; JA/KO exact substring; no rule whose `before` is a substring of another active rule's `after` (no cascade); single pass, no re-scan of replaced output.
- **Apply point:** post-STT pass adjacent to `filterSegments` (`desktop/src/main/engines/segment-filters.ts:115`), finalize path first; live-chunk application deferred (finalize is where notes/exports read from).

## 4. Touch points (verified 2026-07-07)

| File | Change |
|---|---|
| `desktop/src/shared/stt/glossary.ts` | `suggestGlossaryTerms` evolves to diff-span extraction (pure, testable) |
| `desktop/src/renderer/lib/glossary-auto.ts` | call site emits both consumers' registrations |
| `desktop/src/main/glossary-store.ts` | + sibling corrections store |
| `desktop/src/main/engines/segment-filters.ts` | + replacement pass (or sibling module, applied where filterSegments is applied) |
| `GlossaryAdded.tsx` banner | shows both kinds, per-item undo |

## 5. Testing

- Diff extractor unit tests: JA (katakana, kanji), KO (Hangul), EN, mixed, punctuation-only edit, full-rewrite edit (→ no spans; a rewrite is not a correction).
- Replacement pass: boundary cases, overlap/cascade guards, idempotence (running twice = once).
- Recurrence gate: 1st sighting inactive → 2nd activates (replacement rules AND Hangul-only glossary spans; katakana/Latin/kanji glossary spans bypass).
- Regression fixture (fail-first per testing rules): a real misheard→corrected pair; prove next transcription of the same audio fixture comes out corrected via the active rule.

## 6. Non-goals

- Whisper fine-tuning / on-device learning.
- Editing accuracy of past transcripts beyond the user's own edit (no retroactive re-apply in v1).
- Cloud-side anything (fully local feature).

## 7. Open at implementation (deliberate, not placeholders)

- Diff algorithm choice per script (word vs char-run) — pick with tests at impl.
- Whether live-chunk path also applies replacements (default: finalize-only first; revisit after dogfood).
- Exact banner copy (JA-first localization).
