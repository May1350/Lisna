/**
 * Proper-noun glossary → Whisper `initial_prompt` biasing (STT Phase 1).
 *
 * Whisper accepts an `initial_prompt` string that seeds the decoder's context,
 * nudging it toward the spelling of domain terms it would otherwise mis-hear
 * (names, companies, jargon). This is a LEXICAL bias bounded by acoustics — it
 * cannot invent words the audio doesn't contain, so it is safe against the
 * fabrication failure mode Lisna fights elsewhere. The benefit only shows on
 * real audio with real proper nouns; the synthetic ja-30s fixture has none.
 *
 * These functions are PURE (no fs) so they live in `shared/` and are usable
 * from main, the eval scripts, and tests alike. The userData glossary file is
 * read in `main/` (see `loadGlossaryInitialPrompt` in ipc.ts) and passed
 * through `parseGlossary` → `buildInitialPrompt`.
 *
 * Default is EMPTY: with no terms the prompt is '' and the transcribe path is
 * byte-identical to before this feature (no behavioral change until a founder
 * supplies a glossary).
 */

/** Default proper-noun glossary. Empty until a founder supplies terms (via the
 *  userData `glossary.json`, or the eval `--initial-prompt` flag). */
export const DEFAULT_GLOSSARY: readonly string[] = [];

/** Whisper truncates `initial_prompt` to the last ~224 tokens; cap the list so
 *  it stays fully effective and the file stays bounded. Per-term length cap
 *  keeps a single pasted paragraph from eating the budget. */
export const MAX_GLOSSARY_TERMS = 64;
export const MAX_TERM_LEN = 40;

/**
 * Clean a user-supplied term list for persistence + display: trim, drop empty
 * and over-long terms, de-dupe (first occurrence wins — case-sensitive, since
 * product names like "iOS" are meaningful), cap to MAX_GLOSSARY_TERMS. Pure.
 */
export function normalizeGlossary(terms: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const term of terms) {
    if (typeof term !== 'string') continue;
    const t = term.trim();
    if (t.length === 0 || t.length > MAX_TERM_LEN || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= MAX_GLOSSARY_TERMS) break;
  }
  return out;
}

/**
 * Validate an untrusted value (e.g. parsed `glossary.json`) into a clean term
 * list: keep only non-empty trimmed strings, in order. Non-array / wrong-shape
 * input yields `[]` (the file is optional; a malformed one is ignored, not
 * fatal).
 */
export function parseGlossary(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const t = item.trim();
    if (t.length > 0) out.push(t);
  }
  return out;
}

/**
 * Build a Whisper `initial_prompt` from a list of proper-noun terms. Terms are
 * trimmed, de-duplicated (first occurrence wins), and joined with the JA
 * ideographic comma `、` (reads as a natural term list to a multilingual
 * Whisper and keeps the prompt short — Whisper truncates the prompt to the
 * last ~224 tokens, so a runaway glossary silently drops its head). Returns ''
 * for an empty/whitespace-only list, which the engine treats as "no prompt".
 */
export function buildInitialPrompt(terms: readonly string[]): string {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const term of terms) {
    const t = term.trim();
    if (t.length === 0 || seen.has(t)) continue;
    seen.add(t);
    cleaned.push(t);
  }
  return cleaned.join('、');
}

/** Max terms surfaced from one edit — keeps a huge paste from flooding the
 *  suggestion banner. The user confirms each, so this is only a sanity bound. */
export const MAX_SUGGESTIONS = 12;

// Katakana-block run (≥2), keeping ・ / ー so a full foreign name stays whole
// (スティーブ・ジョブズ). Latin/product-name run (iOS, K-LMS, GPT4), ≥2 chars.
// HAS_KANA drops punctuation-only katakana runs (・・, ーー). These two scripts
// are the high-precision proper-noun signal Whisper actually mis-hears; kanji
// NER is out of reach, and a missed kanji name just yields no suggestion.
const KATAKANA_RUN = /[゠-ヿ]{2,}/g;
const LATIN_RUN = /[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*/g;
const HAS_KANA = /[ァ-ヺ]/;

function extractProperNounRuns(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(KATAKANA_RUN)) {
    if (HAS_KANA.test(m[0])) out.push(m[0]);
  }
  for (const m of text.matchAll(LATIN_RUN)) {
    if (m[0].length >= 2) out.push(m[0]);
  }
  return out;
}

/**
 * Suggest glossary terms from transcript edits (before → after per segment).
 * When a user corrects a mis-heard proper noun, the corrected surface form is
 * exactly what the glossary should bias STT toward next time. Surfaces katakana
 * and Latin/product-name runs present in `after` but NOT verbatim in that
 * segment's `before`, minus terms already in the glossary, de-duped and capped.
 * PURE (no fs/UI). Suggestions are confirm-gated at the call site — never
 * auto-applied — so a false positive costs only a dismissed chip.
 */
export function suggestGlossaryTerms(
  edits: readonly { before: string; after: string }[],
  existing: readonly string[],
): string[] {
  const existingSet = new Set(existing);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const { before, after } of edits) {
    for (const run of extractProperNounRuns(after)) {
      if (before.includes(run) || existingSet.has(run) || seen.has(run)) continue;
      if (run.length > MAX_TERM_LEN) continue;
      seen.add(run);
      out.push(run);
      if (out.length >= MAX_SUGGESTIONS) return out;
    }
  }
  return out;
}
