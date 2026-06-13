import { describe, it, expect } from 'vitest';
import {
  consolidateLectureSections,
  MAX_FOLD_GAP_SEC,
} from '../consolidate-lecture-sections';
import { LectureNoteSchema, type LectureSection, type LectureNote } from '../../families/lecture/schema';

// ---------------------------------------------------------------------------
// Minimal builders — inline, no shared helper (1 call site today; plan B note)
// ---------------------------------------------------------------------------

type From = 'transcript' | 'inferred';

function makeSection(ts: number, overrides: {
  heading?: string;
  summary?: string;
  key_terms?: LectureSection['key_terms'];
  examples?:  LectureSection['examples'];
  points?:    LectureSection['points'];
  extras?:    LectureSection['extras'];
} = {}): LectureSection {
  return {
    heading: overrides.heading ?? `Section at ${ts}`,
    ts,
    summary: overrides.summary ?? `Summary for ts=${ts}`,
    key_terms: overrides.key_terms ?? [],
    examples:  overrides.examples ?? [],
    points:    overrides.points ?? [],
    ...(overrides.extras !== undefined ? { extras: overrides.extras } : {}),
  };
}

function makeNote(sections: LectureSection[]): LectureNote {
  return {
    schemaVersion: 1,
    family: 'lecture' as const,
    title: 'Test Lecture',
    generatedAt: '2026-06-13T00:00:00.000Z',
    generatedBy: { model: 'test-model', promptVersion: 1 },
    language: 'ja' as const,
    durationSec: sections.length > 0 ? ((sections[sections.length - 1]?.ts ?? 0) + 60) : 60,
    sections,
  };
}

// 12 JA economics key-terms with zero pairwise trigram similarity — verified
// empirically (max pairwise jaccard = 0.0) so they do not deduplicate.
const DISTINCT_JA_TERMS = [
  '需要と供給', '限界効用', '国内総生産', '為替レート',
  'インフレ率', 'デフレ', '財政政策', '金融政策',
  '乗数効果', '比較優位', '機会費用', '規模の経済',
];

// 29 English point texts, max pairwise jaccard = 0.49 — all below DEDUP_T=0.7.
const POINTS_S0_REGULAR = [
  'supply curve shifts right when cost falls',
  'demand increases as income rises',
  'equilibrium reached where supply meets demand',
  'price ceiling causes shortages',
  'price floor leads to surplus',
  'elasticity measures responsiveness',
  'substitute goods affect cross-price demand',
  'complementary goods used together',
  'normal goods demand rises with income',
  'inferior goods demand falls with income',
  'consumer surplus above equilibrium price',
  'producer surplus below equilibrium price',
];
const POINTS_S1_REGULAR = [
  'monopoly restricts output to raise profit',
  'oligopoly involves few large firms',
  'perfect competition has many small firms',
  'barriers to entry protect incumbents',
  'deadweight loss from market power',
  'price discrimination segments buyers',
  'natural monopoly has declining average cost',
  'cartel members restrict production jointly',
  'game theory models strategic interaction',
  'nash equilibrium no player wants to deviate',
  'dominant strategy best regardless of opponent',
  'prisoners dilemma both defect despite mutual gain',
];
const POINTS_S1_IMPORTANT = [
  'gdp measures total output of economy',
  'unemployment rate tracks jobless workers',
  'inflation erodes purchasing power over time',
  'monetary policy set by central bank',
  'fiscal policy involves government spending',
];

// ---------------------------------------------------------------------------
// Tests (Step 1 — will FAIL until consolidate-lecture-sections.ts is created)
// ---------------------------------------------------------------------------

describe('consolidateLectureSections', () => {

  it('folds adjacent sections to targetCap when gaps are small', () => {
    // 15 sections at ts 0,10,20,...140 (gap=10s each, well below MAX_FOLD_GAP_SEC)
    const sections = Array.from({ length: 15 }, (_, i) => makeSection(i * 10));
    const note = makeNote(sections);
    const { note: result, stats } = consolidateLectureSections(note, 10);
    expect(result.sections.length).toBe(10);
    expect(stats.folded).toBe(5);
  });

  it('tiebreak — equal gaps fold the earliest pair', () => {
    // 3 sections ts 0,10,20 — both gaps are 10s (tie).
    // Tiebreak = lowest index i → fold pair (0,1) first.
    // Result: section[0] ts===0 (merged 0+1), section[1] ts===20.
    const sections = [makeSection(0), makeSection(10), makeSection(20)];
    const note = makeNote(sections);
    const { note: result, stats } = consolidateLectureSections(note, 2);
    expect(result.sections.length).toBe(2);
    expect(result.sections[0]!.ts).toBe(0);
    expect(result.sections[1]!.ts).toBe(20);
    expect(stats.folded).toBe(1);
  });

  it('does NOT fold across gaps > MAX_FOLD_GAP_SEC', () => {
    // 12 sections spaced 600s apart — all gaps exceed MAX_FOLD_GAP_SEC (300s).
    // consolidate stops early; count stays at 12 (within hard ceiling of 24).
    const sections = Array.from({ length: 12 }, (_, i) => makeSection(i * 600));
    expect(600).toBeGreaterThan(MAX_FOLD_GAP_SEC); // guard: fixture must exceed guard
    const note = makeNote(sections);
    const { note: result, stats } = consolidateLectureSections(note, 10);
    expect(result.sections.length).toBe(12);
    expect(stats.folded).toBe(0);
  });

  it('fits sub-arrays to cap after a fold', () => {
    // 2 adjacent sections (small gap), each with 8 DISTINCT key_terms (12 total).
    // After folding → 16 key_terms → must be truncated to cap of 12.
    // Use DISTINCT_JA_TERMS (zero pairwise trigram overlap) so dedup doesn't fire.
    const s0 = makeSection(0, {
      key_terms: DISTINCT_JA_TERMS.slice(0, 8).map((term, i) => ({
        term, definition: `def${i}`, ts: i, from: 'transcript' as From,
      })),
    });
    const s1 = makeSection(10, {
      key_terms: DISTINCT_JA_TERMS.slice(0, 8).map((term, i) => ({
        term, definition: `def${i}`, ts: 10 + i, from: 'transcript' as From,
      })),
    });
    const note = makeNote([s0, s1]);
    const { note: result, stats } = consolidateLectureSections(note, 1);
    expect(result.sections.length).toBe(1);
    // 16 unique terms → dedup yields 8 unique (same 8 terms repeated), then cap=12 → 8
    // Actually same 8 terms are near-identical → dedup to 8 (not 16), which is ≤12.
    // The test intent: after fold+fit, result is ≤12.
    expect(result.sections[0]!.key_terms.length).toBeLessThanOrEqual(12);
    // At least 4 items were dropped (either by dedup or truncation)
    expect(stats.truncated + stats.deduped).toBeGreaterThanOrEqual(4);
  });

  it('fits sub-arrays to cap after a fold (all unique terms)', () => {
    // Use all 12 DISTINCT terms in s0, and a different set of 4 in s1.
    // Total 16 unique → dedup yields 16 → cap 12 → truncated 4.
    const makeKT = (terms: string[]) => terms.map((term, i) => ({
      term, definition: `def${i}`, ts: i, from: 'transcript' as From,
    }));
    const s0 = makeSection(0,  { key_terms: makeKT(DISTINCT_JA_TERMS) }); // 12 unique
    // 4 extra terms that are distinct from all 12 (use short Latin chars)
    const extra4 = ['アルファ', 'ベータ', 'ガンマ', 'デルタ'];
    const s1 = makeSection(10, { key_terms: makeKT(extra4) }); // 4 unique
    const note = makeNote([s0, s1]);
    const { note: result, stats } = consolidateLectureSections(note, 1);
    expect(result.sections.length).toBe(1);
    expect(result.sections[0]!.key_terms.length).toBe(12);
    expect(stats.truncated).toBeGreaterThanOrEqual(4);
  });

  it('dedups near-duplicate sub-array items before truncating', () => {
    // キャッシュフロー計算書 vs キャッシュフロー計算書の作成 → jaccard ≈ 0.75 (> 0.7).
    const s0 = makeSection(0, {
      key_terms: [{ term: 'キャッシュフロー計算書', definition: '現金の流れを示す財務表', ts: 0, from: 'transcript' }],
    });
    const s1 = makeSection(10, {
      key_terms: [{ term: 'キャッシュフロー計算書の作成', definition: '作成手順', ts: 10, from: 'transcript' }],
    });
    const note = makeNote([s0, s1]);
    const { note: result, stats } = consolidateLectureSections(note, 1);
    expect(result.sections.length).toBe(1);
    // Near-dup pair should have been collapsed
    expect(stats.deduped).toBeGreaterThanOrEqual(1);
    expect(result.sections[0]!.key_terms.length).toBe(1);
  });

  it('ranks points by important before truncating', () => {
    // A fold producing >20 points where important:true ones are at the TAIL.
    // After fit, ALL important:true points must survive; total === 20.
    //
    // s0: 12 regular points; s1: 12 regular + 5 important.
    // Total: 29 distinct (max pairwise jaccard=0.49) → dedup keeps all 29 → cap 20.
    // important:true are placed last in concat order → ranking must move them first.
    const makePoints = (texts: string[], important: boolean) =>
      texts.map((text, i) => ({ text, ts: i, important, from: 'transcript' as From }));

    const s0 = makeSection(0,  { points: makePoints(POINTS_S0_REGULAR, false) });
    const s1 = makeSection(10, {
      points: [
        ...makePoints(POINTS_S1_REGULAR,   false), // 12 regular
        ...makePoints(POINTS_S1_IMPORTANT, true),  // 5 important — at tail
      ],
    });
    const note = makeNote([s0, s1]);
    const { note: result } = consolidateLectureSections(note, 1);
    const pts = result.sections[0]!.points;
    expect(pts.length).toBe(20);
    // ALL 5 important:true points must be in the output
    const importantKept = pts.filter(p => p.important);
    expect(importantKept.length).toBe(5);
  });

  it('consolidated note passes LectureNoteSchema.strict().parse', () => {
    // A valid multi-section note → consolidate → schema.parse must not throw.
    const sections = Array.from({ length: 5 }, (_, i) => makeSection(i * 5, {
      key_terms: [{ term: `term${i}`, definition: 'def', ts: i, from: 'transcript' }],
      examples:  [{ text: `example${i}`, ts: i, from: 'transcript' }],
      points:    [{ text: `point${i}`, ts: i, important: false, from: 'transcript' }],
    }));
    const note = makeNote(sections);
    const { note: result } = consolidateLectureSections(note, 3);
    expect(() => LectureNoteSchema.strict().parse(result)).not.toThrow();
  });

});
