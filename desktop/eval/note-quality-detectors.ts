// desktop/eval/note-quality-detectors.ts
//
// Offline detector scorer for the failure class the existing scorers MISS.
// The 2026-06-23 review found `faithfulnessPrepass.groundingJa` ≈ 1.0 on a
// verbatim-copy note (copied text IS in the transcript) — i.e. it REWARDS the
// pathology. coverage.ts needs a gold key and is blind to garble/markers too.
// These detectors are the missing instrument for the STEP 1 model comparison:
// a swap can only "win" if it lowers copyRate + zeroes garble/markers/placeholders,
// not just keeps groundingJa high.
//
// Reuses the SAME pure functions the production assembler filters with
// (shared/families/meeting/quality-filters), so the eval measures exactly what
// the pipeline drops.
import {
  hasLeakedMarker,
  hasMixedScript,
  isPlaceholderAtom,
  isVerbatimSegmentCopy,
} from '@shared/families/meeting/quality-filters';

export interface NoteQualityDetectors {
  /** note strings still carrying a "[N]"/"[話者N]" marker (should be 0). */
  leakedMarkerCount: number;
  /** note strings containing out-of-script homoglyph garble (should be 0). */
  mixedScriptCount: number;
  /** content atoms that are generic hallucinated placeholders (should be 0). */
  placeholderCount: number;
  /** fraction of content atoms that are near-verbatim transcript copies — the
   *  echo-instead-of-extract signal. Lower is better; a good model abstracts. */
  copyRate: number;
  /** denominator for copyRate (decisions + next_steps + open_questions + risks). */
  contentAtoms: number;
}

const SYSTEM_KEYS = new Set([
  'family', 'language', 'from', 'model', 'generatedAt', 'experimentArmId',
  'schemaVersion', 'generatedBy', 'promptVersion',
]);

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

/** Pull the user-visible content-atom texts (the fields where copy/placeholder
 *  pathologies live) from a note-shaped object. Family-agnostic best-effort. */
function contentAtomTexts(note: Record<string, unknown>): string[] {
  const fields = ['decisions', 'next_steps', 'open_questions', 'risks_or_concerns', 'action_items'];
  const out: string[] = [];
  for (const f of fields) {
    const arr = note[f];
    if (Array.isArray(arr)) {
      for (const a of arr) {
        const t = (a as { text?: unknown; task?: unknown })?.text ?? (a as { task?: unknown })?.task;
        if (typeof t === 'string') out.push(t);
      }
    }
  }
  return out;
}

export function noteQualityDetectors(
  note: unknown,
  transcriptSegmentTexts: ReadonlyArray<string>,
): NoteQualityDetectors {
  const allStrings: string[] = [];
  collectStrings(note, allStrings);
  const atoms = contentAtomTexts((note ?? {}) as Record<string, unknown>);

  const copies = atoms.filter((t) => isVerbatimSegmentCopy(t, transcriptSegmentTexts)).length;
  return {
    leakedMarkerCount: allStrings.filter(hasLeakedMarker).length,
    mixedScriptCount: allStrings.filter(hasMixedScript).length,
    placeholderCount: atoms.filter(isPlaceholderAtom).length,
    copyRate: atoms.length ? +(copies / atoms.length).toFixed(3) : 0,
    contentAtoms: atoms.length,
  };
}
