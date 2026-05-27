/**
 * Estimate LLM token count for a string.
 *
 * Calibrated against kotoba-whisper-v2 + Llama 3.2 tokenizer empirics
 * during Spike 0.4: ~0.6 tokens/char for JA-dense input, ~0.25 tokens/char
 * for ASCII. Used for chunk-budget decisions (chunkTranscript).
 *
 * CJK coverage extended in Plan 2 Task 6 from Spike 0.4's original three
 * ranges to seven (carry-forward M-2):
 *
 *   - hiragana        U+3040-U+309F
 *   - katakana        U+30A0-U+30FF
 *   - CJK basic       U+4E00-U+9FFF
 *   - CJK Ext A       U+3400-U+4DBF  (NEW)
 *   - halfwidth kana  U+FF61-U+FF9F  (NEW)
 *   - fullwidth ASCII U+FF01-U+FF5E  (NEW)
 *   - JP punct        U+3000-U+303F  (NEW)
 *
 * Anything not in the above ranges is treated as ASCII at 0.25 t/char.
 * This is exported from `@shared/note-schema` so eval-time fixture-builders
 * and tests use the SAME estimator as the production chunker, avoiding the
 * 6.6% drift observed in Spike 0.4's synth.test.ts.
 *
 * The JP-punct range start (U+3000 ideographic space) is encoded as the
 * \u3000 escape in the regex below to satisfy no-irregular-whitespace;
 * functionally equivalent to the literal codepoint.
 */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  const cjkRegex = /[぀-ゟ゠-ヿ一-鿿㐀-䶿｡-ﾟ！-～\u3000-〿]/g;
  const cjkCount = (text.match(cjkRegex) ?? []).length;
  const asciiCount = text.length - cjkCount;
  return Math.ceil(cjkCount * 0.6 + asciiCount * 0.25);
}
