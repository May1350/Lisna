// desktop/eval/coverage.ts
//
// SCORED coverage: fraction of mustAppear answer-key points the note captured.
// Pure — consumed by single-fixture.ts (scorecard) AND the contract qa-coverage
// rules. Match is JA-friendly normalized-substring (same as the existing rules).

import { normalizeKeyTerm, type FixtureGroundTruth } from './fixtures/_schema';
import type { NoteFamily } from './judges/judge-types';

export interface CoverageResult {
  captured: number;
  total: number;
  ratio: number;        // captured / total, or 0 when total === 0
  missing: string[];    // the required points NOT found in the note
}

function normContains(haystack: string, needle: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
  return norm(haystack).includes(norm(needle));
}

/** Flatten every user-visible string in the note into one haystack for
 *  family-agnostic "does this point appear anywhere" matching. */
function noteHaystack(v: unknown, out: string[]): void {
  if (typeof v === 'string') { out.push(v); return; }
  if (Array.isArray(v)) { for (const x of v) noteHaystack(x, out); return; }
  if (v && typeof v === 'object') for (const x of Object.values(v)) noteHaystack(x, out);
}

export function computeCoverage(
  family: NoteFamily,
  note: any,
  groundTruth: FixtureGroundTruth | undefined,
): CoverageResult {
  const empty: CoverageResult = { captured: 0, total: 0, ratio: 0, missing: [] };
  if (!groundTruth) return empty;

  // Required points + how to test each, per family.
  let required: string[] = [];
  let found: (point: string) => boolean;

  if (family === 'interview' && groundTruth.qaPairs) {
    required = groundTruth.qaPairs.filter(p => p.mustAppear ?? true).map(p => p.q);
    const noteQs: string[] = (note.qa_pairs ?? []).map((p: any) => String(p.question ?? ''));
    found = (point) => noteQs.some(q => normContains(q, point));
  } else if (family === 'lecture' && groundTruth.expectedKeyTerms) {
    required = groundTruth.expectedKeyTerms.map(normalizeKeyTerm).filter(k => k.mustAppear).map(k => k.term);
    const hay: string[] = [];
    noteHaystack(note, hay);
    const blob = hay.join('\n');
    found = (point) => normContains(blob, point);
  } else if (family === 'meeting' && groundTruth.decisions) {
    required = groundTruth.decisions.filter(d => d.mustAppear).map(d => d.text);
    const noteDecisions: string[] = (note.decisions ?? []).map((d: any) => String(d.text ?? ''));
    found = (point) => noteDecisions.some(t => normContains(t, point));
  } else {
    return empty;
  }

  if (required.length === 0) return empty;
  const missing = required.filter(p => !found(p));
  const captured = required.length - missing.length;
  return { captured, total: required.length, ratio: +(captured / required.length).toFixed(3), missing };
}
