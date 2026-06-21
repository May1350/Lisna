/**
 * Field-specific dedup primitives for MeetingNote assembly.
 *
 * Task 2: normalizeFigureValue, unionKeyFigures, extractAnchors, unionContentAtoms
 */
import { trigrams, jaccard } from '@shared/post-decode/deterministic-merge';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

export const toAsciiDigits = (s: string): string =>
  s.replace(/[０-９]/g, (d) => String('０１２３４５６７８９'.indexOf(d)));

const normLabel = (s: string): string => toAsciiDigits(s).replace(/\s/g, '').toLowerCase();

export const NUM_RE = /[0-9][0-9,，.．]*(?:万|億|%|％|円)?/g;
export const KATA_RE = /[ァ-ヴー]{2,}/g;
export const LATIN_RE = /[A-Za-z][A-Za-z0-9]{1,}/g;

// ---------------------------------------------------------------------------
// Exported dedup helpers
// ---------------------------------------------------------------------------

// Contentless filler utterances the 3B mis-extracts as decisions/actions
// ("決める", "そうなんです", "決めましょう"). Anchored to the WHOLE trimmed text so
// a real decision with content ("予算を決める") never matches. Deterministic
// drop is robust where prompt instructions are not — naming these in the
// extraction prompt PRIMED the 3B to emit them (eval p1tune-1, 15×"決めましょう。").
const FILLER_RE =
  /^(?:はい|ええ|うん|うーん|なるほど|そう(?:です|ですね|なんです|なんですね)?|わかりました|了解(?:です)?|お願いします|決め(?:る|ます|ました|ましょう)|やり(?:ます|ましょう)|やる|それで(?:いきましょう|いいです(?:ね)?)?)[。、．，！!？?\s]*$/;

/** True when the atom text is contentless filler (drop before union). */
export function isFillerAtomText(text: string): boolean {
  return FILLER_RE.test(text.trim());
}

/**
 * Strip separators + 円, normalize digits, KEEP unit suffixes (万/億/%) so
 * 4,200 and 4,200万 stay distinct.
 */
export function normalizeFigureValue(v: string): string {
  return toAsciiDigits(v).replace(/[,，、\s円]/g, '');
}

/**
 * Union key figures across chunks. Dedup by `normLabel + '::' + normalizeFigureValue(value)`.
 * First occurrence wins. NEVER trigram. Distinct numbers always survive.
 */
export function unionKeyFigures<T extends { label: string; value: string; ts?: number }>(
  perChunk: ReadonlyArray<ReadonlyArray<T>>,
): T[] {
  const byKey = new Map<string, T>();
  for (const chunk of perChunk) {
    for (const f of chunk) {
      const key = `${normLabel(f.label)}::${normalizeFigureValue(f.value)}`;
      if (!byKey.has(key)) byKey.set(key, f);
    }
  }
  return [...byKey.values()];
}

/** Extract number tokens and proper-noun-ish tokens from text. */
export function extractAnchors(text: string): { numbers: string[]; nouns: string[] } {
  const t = toAsciiDigits(text);
  const numbers = (t.match(NUM_RE) ?? []).map((n) => n.replace(/[,，.．]/g, ''));
  const nouns = [...(text.match(KATA_RE) ?? []), ...(text.match(LATIN_RE) ?? [])].map((s) => s.toLowerCase());
  return { numbers, nouns };
}

/**
 * Concat then drop a later atom only when it shares an anchor (number OR noun)
 * with an earlier kept atom AND text trigram jaccard >= threshold.
 */
export function unionContentAtoms<T extends { text: string; ts?: number }>(
  perChunk: ReadonlyArray<ReadonlyArray<T>>,
  opts?: { threshold?: number },
): T[] {
  const threshold = opts?.threshold ?? 0.7;
  const kept: Array<{ atom: T; grams: Set<string>; anchors: ReturnType<typeof extractAnchors> }> = [];
  for (const chunk of perChunk) {
    for (const atom of chunk) {
      const grams = trigrams(atom.text);
      const anchors = extractAnchors(atom.text);
      const dup = kept.some((k) => {
        const sharesAnchor =
          anchors.numbers.some((n) => k.anchors.numbers.includes(n)) ||
          anchors.nouns.some((n) => k.anchors.nouns.includes(n));
        return sharesAnchor && grams.size > 0 && k.grams.size > 0 && jaccard(grams, k.grams) >= threshold;
      });
      if (!dup) kept.push({ atom, grams, anchors });
    }
  }
  return kept.map((k) => k.atom);
}
