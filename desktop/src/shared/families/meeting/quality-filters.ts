/**
 * Deterministic quality filters + detectors for MeetingNote assembly.
 *
 * Born from a real founder failure (2026-06-23): a 10-min JA meeting where the
 * 3B extractor (a) echoed the first N transcript lines verbatim — WITH the
 * "[ts] [話者id]" markers from the rendered prompt — as "decisions", (b) looped
 * one phrase and, evading the DRY repeat-penalty under a permissive grammar,
 * mutated it into mixed-script garble (hangul/arabic/cyrillic), and (c)
 * hallucinated generic meta-questions ("この会議で何が話されましたか?") as
 * open_questions/risks.
 *
 * These are pure functions used in TWO places:
 *  - assemble.ts — as production FILTERS (strip markers + drop garbage atoms).
 *  - the note eval — as DETECTORS/scorers (the existing groundingJa scorer
 *    REWARDS verbatim-copy with ≈1.0, so it cannot see this failure class).
 *
 * Scope: meeting notes are ja/en only (ko is transcript-only, Phase 1). A JA/EN
 * note never legitimately contains hangul/arabic/cyrillic, so those scripts are
 * unambiguous garble here. If Korean structured notes ever ship, hasMixedScript
 * must become language-aware.
 */

// "[123]" segment-index and "[話者0]" speaker markers that renderChunk injects
// into the prompt and the 3B then echoes into its extracted text.
const MARKER_RE = /\[\d+\]|\[話者\d+\]/g;

/** Strip leaked "[ts]"/"[話者id]" markers and collapse the resulting whitespace.
 *  Run BEFORE filler-drop (FILLER_RE is ^…$-anchored, so "[0] [話者0] はい" would
 *  never match it) and before the text is stored in the note. */
export function stripSpeakerMarker(text: string): string {
  return text.replace(MARKER_RE, '').replace(/\s+/g, ' ').trim();
}

/** Detector: any "[N]"/"[話者N]" marker survived into a note string. */
export function hasLeakedMarker(text: string): boolean {
  return /\[\d+\]|\[話者\d+\]/.test(text);
}

// Out-of-script code-point ranges that never appear in a legitimate JA/EN note:
// Hangul (jamo/compat/syllables), Arabic, Cyrillic, Thai, Devanagari, and the
// Unicode replacement char. (JA = hiragana/katakana/kanji/halfwidth-kana; EN/brand
// = ASCII + fullwidth latin.) Checked by code point rather than a regex char-class
// so combining-mark ranges don't trip eslint no-misleading-character-class.
const NON_JA_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x11ff], [0x3130, 0x318f], [0xac00, 0xd7a3], // Hangul jamo / compat / syllables
  [0x0600, 0x06ff], // Arabic
  [0x0400, 0x04ff], // Cyrillic
  [0x0e00, 0x0e7f], // Thai
  [0x0900, 0x097f], // Devanagari
  [0xfffd, 0xfffd], // Unicode replacement char
];

/** Detector + filter: text contains out-of-script garble (the DRY-evasion
 *  homoglyph mutation). A JA/EN meeting note string with these is garbage. */
export function hasMixedScript(text: string): boolean {
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (NON_JA_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi)) return true;
  }
  return false;
}

// Generic meta-questions/risks ABOUT the meeting (not FROM it) that the 3B
// emits when it has nothing real to extract. Conservative: anchored to the
// "この会議…" meta-template + the "どのようなリスク" stem, so a real question that
// merely mentions 会議 is not dropped.
const PLACEHOLDER_RE =
  /^この会議(?:で(?:は)?(?:何|どの|どん)|の(?:結果|内容|目的|まとめ|ポイント))|どのようなリスク(?:が(?:生じる|ある))/;

/** Detector + filter: a generic hallucinated placeholder question/risk. */
export function isPlaceholderAtom(text: string): boolean {
  return PLACEHOLDER_RE.test(stripSpeakerMarker(text));
}

/**
 * Detector (SCORING ONLY — never a hard drop): is the text a near-verbatim copy
 * of a single transcript segment? A good extractor abstracts; a high copy-rate
 * means the model echoed the transcript instead of extracting. Used by the eval
 * to quantify the residual model-capacity gap — NOT used to filter, because a
 * terse-but-real decision can legitimately match a segment.
 */
export function isVerbatimSegmentCopy(text: string, segmentTexts: ReadonlyArray<string>): boolean {
  const t = stripSpeakerMarker(text);
  if (t.length < 4) return false;
  return segmentTexts.some((s) => {
    const st = s.trim();
    if (st.length < 4) return false;
    return st === t || st.includes(t) || t.includes(st);
  });
}
