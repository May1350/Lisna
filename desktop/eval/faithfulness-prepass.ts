// desktop/eval/faithfulness-prepass.ts
//
// Deterministic, no-LLM faithfulness pre-pass. Lifted from
// scripts/note-quality-eval.ts::scoreNote (the dump-replay rig) so the
// fixture-based runner shares the SAME #118 language-flip guard + grounding
// without an LLM round-trip. Fails fast on a wholesale JA→EN flip before any
// judge call is made.

/** A JA note whose jaRatio drops below this is a wholesale English flip (the
 *  #118 fabrication signature; healthy JA notes sit ≥ 0.15). */
export const JA_FLIP_MIN_RATIO = 0.15;

export interface FaithfulnessPrepass {
  jaRatio: number;       // JA-script share of user-visible strings
  languageFlip: boolean; // jaRatio < JA_FLIP_MIN_RATIO
  groundingJa: number;   // fraction of kanji/katakana runs (≥2) found in transcript
  groundingAscii: number; // fraction of ASCII words (≥4) found in transcript
}

const JA_SCRIPT_RE = /[぀-ゟ゠-ヿ一-鿿㐀-䶿｡-ﾟ　-〿]/g;
// System/meta keys carry model/language identifiers, never note CONTENT — exclude
// them so an English model id can't dilute jaRatio. Superset of the rig's SYSTEM_KEYS
// (also drops the v2 schema fields schemaVersion/generatedBy/promptVersion).
const SYSTEM_KEYS = new Set(['family', 'language', 'from', 'model', 'generatedAt', 'experimentArmId', 'schemaVersion', 'generatedBy', 'promptVersion']);

function collectStrings(v: unknown, out: string[]): void {
  if (typeof v === 'string') { out.push(v); return; }
  if (Array.isArray(v)) { for (const x of v) collectStrings(x, out); return; }
  if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      if (SYSTEM_KEYS.has(k)) continue;
      collectStrings(x, out);
    }
  }
}

export function faithfulnessPrepass(note: unknown, transcriptText: string): FaithfulnessPrepass {
  const parts: string[] = [];
  collectStrings(note, parts);
  // '\n' (not '') so adjacent fields' kanji runs don't coalesce across boundaries.
  // The rig (note-quality-eval.ts:129) uses '' — a latent merge bug for short fields;
  // '\n' is not a JA-script char so it can't affect jaRatio / the language-flip gate.
  const text = parts.join('\n');
  const jaChars = (text.match(JA_SCRIPT_RE) ?? []).length;
  const jaRatio = text.length ? jaChars / text.length : 0;

  const jaRuns = [...new Set(text.match(/[一-鿿㐀-䶿゠-ヿ]{2,}/g) ?? [])];
  const groundedJa = jaRuns.filter((r) => transcriptText.includes(r)).length;
  const asciiWords = [...new Set((text.match(/[a-zA-Z]{4,}/g) ?? []).map((w) => w.toLowerCase()))];
  const groundedAscii = asciiWords.filter((w) => transcriptText.toLowerCase().includes(w)).length;

  return {
    jaRatio: +jaRatio.toFixed(3),
    languageFlip: jaRatio < JA_FLIP_MIN_RATIO,
    groundingJa: jaRuns.length ? +(groundedJa / jaRuns.length).toFixed(3) : 0,
    groundingAscii: asciiWords.length ? +(groundedAscii / asciiWords.length).toFixed(3) : 0,
  };
}
