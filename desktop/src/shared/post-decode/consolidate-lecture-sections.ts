/**
 * consolidateLectureSections — deterministic, LLM-free post-merge step.
 *
 * Called after deterministicMerge, before LectureNoteSchema.parse.
 * Folds adjacent sections toward a duration-aware soft target, then
 * dedup-fits each sub-array to its per-section cap.
 *
 * Design rationale: rung-1 plan (2026-06-13-rung1-lecture-section-consolidation.md)
 * Approach A — static hard ceiling (MAX_SECTIONS=24) handles safety;
 * consolidation handles quality.
 */

import { trigrams, jaccard } from './deterministic-merge';
import type { LectureNote, LectureSection } from '../families/lecture/schema';

/** Adjacent section pairs farther apart than this are never folded together. */
export const MAX_FOLD_GAP_SEC = 300;

/** Per-section sub-array caps — mirrors the Zod schema bounds in lecture/schema.ts. */
const SUB_CAPS = { key_terms: 12, examples: 10, points: 20, extras: 8 } as const;

/** Trigram similarity threshold for dedup within a folded sub-array. */
const DEDUP_T = 0.7;

export interface ConsolidationStats {
  /** How many adjacent section pairs were folded (merged). */
  folded: number;
  /** How many sub-array items were dropped by cap enforcement after dedup. */
  truncated: number;
  /** How many sub-array items were removed as near-duplicates. */
  deduped: number;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

// Working section type — mirrors LectureSection but with mutable arrays.
// We operate between deterministicMerge (output = Partial<T> merged) and
// LectureNoteSchema.parse (validates the final shape). Using the inferred
// LectureSection type keeps this consistent with the schema without
// re-declaring shapes.
type WorkSection = LectureSection;

// Sub-array element types
type KeyTerm  = WorkSection['key_terms'][number];
type Example  = WorkSection['examples'][number];
type Point    = WorkSection['points'][number];
type Extra    = NonNullable<WorkSection['extras']>[number];

// ---------------------------------------------------------------------------
// Dedup key extractors per sub-array field
// ---------------------------------------------------------------------------

function keyOfKeyTerm(x: KeyTerm):   string { return x.term; }
function keyOfExample(x: Example):   string { return x.text; }
function keyOfPoint(x: Point):       string { return x.text; }
function keyOfExtra(x: Extra):       string { return JSON.stringify(x); }

// ---------------------------------------------------------------------------
// Generic trigram-based greedy dedup
// ---------------------------------------------------------------------------

function dedup<T>(arr: T[], keyFn: (x: T) => string): { kept: T[]; removed: number } {
  const kept: { item: T; tg: Set<string> }[] = [];
  let removed = 0;
  for (const x of arr) {
    const tg = trigrams(keyFn(x));
    const isDup = kept.some(k => jaccard(tg, k.tg) >= DEDUP_T);
    if (isDup) {
      removed++;
    } else {
      kept.push({ item: x, tg });
    }
  }
  return { kept: kept.map(k => k.item), removed };
}

// ---------------------------------------------------------------------------
// Fold two adjacent sections into one
// ---------------------------------------------------------------------------

function foldTwo(a: WorkSection, b: WorkSection): WorkSection {
  const takeaway = [a.takeaway, b.takeaway].filter((t): t is string => t !== undefined).join('\n') || undefined;
  const extrasRaw = (a.extras || b.extras)
    ? [...(a.extras ?? []), ...(b.extras ?? [])]
    : undefined;

  // Build merged — only include optional fields when defined so .strict() passes.
  const merged: WorkSection = {
    heading: a.heading,
    ts: a.ts,
    summary: a.summary + '\n' + b.summary,
    key_terms: [...a.key_terms, ...b.key_terms],
    examples:  [...a.examples,  ...b.examples],
    points:    [...a.points,    ...b.points],
  };
  if (takeaway !== undefined) merged.takeaway = takeaway;
  if (extrasRaw !== undefined) merged.extras = extrasRaw;
  return merged;
}

// ---------------------------------------------------------------------------
// Dedup-fit a single section's sub-arrays in-place (returns a new section)
// ---------------------------------------------------------------------------

function dedupFitSection(s: WorkSection, stats: ConsolidationStats): WorkSection {
  // key_terms
  const { kept: ktDeduped, removed: ktRemoved } = dedup(s.key_terms, keyOfKeyTerm);
  stats.deduped += ktRemoved;
  const ktOver = Math.max(0, ktDeduped.length - SUB_CAPS.key_terms);
  stats.truncated += ktOver;
  const key_terms = ktDeduped.slice(0, SUB_CAPS.key_terms);

  // examples
  const { kept: exDeduped, removed: exRemoved } = dedup(s.examples, keyOfExample);
  stats.deduped += exRemoved;
  const exOver = Math.max(0, exDeduped.length - SUB_CAPS.examples);
  stats.truncated += exOver;
  const examples = exDeduped.slice(0, SUB_CAPS.examples);

  // points — dedup first, then rank important:true before truncating
  const { kept: ptDeduped, removed: ptRemoved } = dedup(s.points, keyOfPoint);
  stats.deduped += ptRemoved;
  let points: Point[];
  if (ptDeduped.length > SUB_CAPS.points) {
    // Stable sort: important:true first, keep original order within each group.
    const important = ptDeduped.filter(p => p.important);
    const regular   = ptDeduped.filter(p => !p.important);
    const ranked = [...important, ...regular];
    stats.truncated += ranked.length - SUB_CAPS.points;
    points = ranked.slice(0, SUB_CAPS.points);
  } else {
    points = ptDeduped;
  }

  // extras (optional)
  let extras: Extra[] | undefined = undefined;
  if (s.extras !== undefined) {
    const { kept: extrDeduped, removed: extrRemoved } = dedup(s.extras, keyOfExtra);
    stats.deduped += extrRemoved;
    const extrOver = Math.max(0, extrDeduped.length - SUB_CAPS.extras);
    stats.truncated += extrOver;
    extras = extrDeduped.slice(0, SUB_CAPS.extras) as Extra[];
  }

  const result: WorkSection = {
    heading: s.heading,
    ts: s.ts,
    summary: s.summary,
    key_terms,
    examples,
    points,
  };
  if (s.takeaway !== undefined) result.takeaway = s.takeaway;
  if (extras !== undefined) result.extras = extras;
  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Consolidate lecture sections toward `targetCap` by iteratively folding the
 * adjacent pair with the smallest ts-gap, stopping when the count reaches
 * `targetCap` OR the smallest gap exceeds `MAX_FOLD_GAP_SEC`.
 *
 * After folding, each section's sub-arrays are dedup-fitted to their per-cap.
 *
 * Pure — never mutates `note` or its nested arrays.
 *
 * @param note       Post-deterministicMerge lecture note (pre-schema.parse).
 * @param targetCap  Duration-aware soft target: `clamp(ceil(durationMin/8),10,24)`.
 */
export function consolidateLectureSections(
  note: LectureNote,
  targetCap: number,
): { note: LectureNote; stats: ConsolidationStats } {
  const stats: ConsolidationStats = { folded: 0, truncated: 0, deduped: 0 };

  // Defensive ts-asc sort (deterministicMerge already sorts, but be safe).
  let sections: WorkSection[] = note.sections
    .slice()
    .sort((a, b) => a.ts - b.ts);

  // --- FOLD ---
  while (sections.length > targetCap) {
    // Find adjacent pair with smallest gap; tiebreak = earliest index.
    let bestIdx = -1;
    let bestGap = Infinity;
    for (let i = 0; i < sections.length - 1; i++) {
      const cur  = sections[i];
      const next = sections[i + 1];
      if (!cur || !next) continue; // noUncheckedIndexedAccess guard
      const gap = next.ts - cur.ts;
      if (gap < bestGap) {
        bestGap = gap;
        bestIdx = i;
      }
    }
    // C2 guard: stop if smallest gap exceeds MAX_FOLD_GAP_SEC.
    if (bestIdx < 0 || bestGap > MAX_FOLD_GAP_SEC) break;

    const a = sections[bestIdx];
    const b = sections[bestIdx + 1];
    if (!a || !b) break; // noUncheckedIndexedAccess guard (should never fire)
    const merged = foldTwo(a, b);
    sections = [
      ...sections.slice(0, bestIdx),
      merged,
      ...sections.slice(bestIdx + 2),
    ];
    stats.folded++;
  }

  // --- DEDUP-FIT ---
  sections = sections.map(s => dedupFitSection(s, stats));

  return { note: { ...note, sections }, stats };
}
