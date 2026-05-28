import { describe, it, expect } from 'vitest';
import { computeBradleyTerry, __testOnly_parsePairwiseResponse } from './pairwise-judge';

describe('parsePairwiseResponse', () => {
  it('parses preference + reasoning', () => {
    const p = __testOnly_parsePairwiseResponse(JSON.stringify({ preferred: 'A', confidence: 0.7, reasoning: 'A has more decisions' }));
    expect(p.preferred).toBe('A');
    expect(p.confidence).toBe(0.7);
  });

  it('defaults invalid input to tie + 0.5 conf', () => {
    const p = __testOnly_parsePairwiseResponse('{}');
    expect(p.preferred).toBe('TIE');
    expect(p.confidence).toBe(0.5);
  });

  it('clamps confidence to [0, 1]', () => {
    const p = __testOnly_parsePairwiseResponse(JSON.stringify({ preferred: 'B', confidence: 1.5 }));
    expect(p.confidence).toBe(1);
    const p2 = __testOnly_parsePairwiseResponse(JSON.stringify({ preferred: 'B', confidence: -0.2 }));
    expect(p2.confidence).toBe(0);
  });

  it('treats non-A/non-B preferred as TIE', () => {
    const p = __testOnly_parsePairwiseResponse(JSON.stringify({ preferred: 'maybe-A' }));
    expect(p.preferred).toBe('TIE');
  });

  it('handles malformed JSON with safe defaults', () => {
    const p = __testOnly_parsePairwiseResponse('not json');
    expect(p.preferred).toBe('TIE');
    expect(p.confidence).toBe(0.5);
    expect(p.reasoning).toBe('');
  });
});

describe('computeBradleyTerry', () => {
  it('A always wins → A rank > B rank', () => {
    const ranks = computeBradleyTerry([
      { a: 'A', b: 'B', winner: 'A' },
      { a: 'A', b: 'B', winner: 'A' },
      { a: 'A', b: 'B', winner: 'A' },
    ]);
    expect(ranks.A).toBeGreaterThan(ranks.B);
  });

  it('balanced wins → comparable ranks', () => {
    const ranks = computeBradleyTerry([
      { a: 'A', b: 'B', winner: 'A' },
      { a: 'A', b: 'B', winner: 'B' },
    ]);
    expect(Math.abs(ranks.A - ranks.B)).toBeLessThan(0.5);
  });

  it('three-way ranking is monotone with win count', () => {
    // winner 'A' = a-slot wins, winner 'B' = b-slot wins (positional, not player name)
    const ranks = computeBradleyTerry([
      { a: 'A', b: 'B', winner: 'A' }, { a: 'A', b: 'B', winner: 'A' },
      { a: 'A', b: 'C', winner: 'A' }, { a: 'A', b: 'C', winner: 'A' },
      { a: 'B', b: 'C', winner: 'A' }, { a: 'B', b: 'C', winner: 'A' },
    ]);
    expect(ranks.A).toBeGreaterThan(ranks.B);
    expect(ranks.B).toBeGreaterThan(ranks.C);
  });
});
