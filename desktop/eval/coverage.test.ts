import { describe, it, expect } from 'vitest';
import { computeCoverage } from './coverage';
import type { FixtureGroundTruth } from './fixtures/_schema';

describe('computeCoverage', () => {
  it('interview: counts mustAppear qaPairs questions found in note.qa_pairs', () => {
    const gt: FixtureGroundTruth = {
      fixtureId: 'fx',
      qaPairs: [
        { q: '売上の状況', a: '減少', mustAppear: true },
        { q: '原価率の方針', a: '改善', mustAppear: true },
        { q: '余談の天気', a: '晴れ', mustAppear: false }, // optional — not counted in total
      ],
    };
    const note = { qa_pairs: [{ question: '売上の状況はどうですか', answer: '前年比で減少' }] };
    const r = computeCoverage('interview', note, gt);
    expect(r.total).toBe(2);          // only mustAppear
    expect(r.captured).toBe(1);       // 売上の状況 matched; 原価率の方針 missing
    expect(r.ratio).toBeCloseTo(0.5);
    expect(r.missing).toEqual(['原価率の方針']);
  });

  it('interview: qaPairs without explicit mustAppear default to required', () => {
    const gt: FixtureGroundTruth = { fixtureId: 'fx', qaPairs: [{ q: 'A', a: 'a' }, { q: 'B', a: 'b' }] };
    const note = { qa_pairs: [{ question: 'A point', answer: 'x' }] };
    const r = computeCoverage('interview', note, gt);
    expect(r.total).toBe(2);
    expect(r.captured).toBe(1);
  });

  it('lecture: counts mustAppear expectedKeyTerms found anywhere in the note', () => {
    const gt: FixtureGroundTruth = {
      fixtureId: 'lec',
      expectedKeyTerms: [{ term: '電位', mustAppear: true }, { term: '静電ポテンシャル', mustAppear: true }, { term: '余談', mustAppear: false }],
    };
    const note = { sections: [{ heading: '電位とは', key_terms: [{ term: '電位', definition: '...' }] }] };
    const r = computeCoverage('lecture', note, gt);
    expect(r.total).toBe(2);
    expect(r.captured).toBe(1);
    expect(r.missing).toEqual(['静電ポテンシャル']);
  });

  it('returns total=0 when the family ground truth has no coverage points', () => {
    const r = computeCoverage('brainstorm', { idea_clusters: [] }, { fixtureId: 'fx' });
    expect(r.total).toBe(0);
    expect(r.ratio).toBe(0);
  });
});
