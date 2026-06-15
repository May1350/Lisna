import { describe, it, expect } from 'vitest';
import { buildInitialPrompt, parseGlossary, DEFAULT_GLOSSARY } from '../glossary';

describe('buildInitialPrompt', () => {
  it('empty list → empty prompt (no behavioral change)', () => {
    expect(buildInitialPrompt([])).toBe('');
    expect(buildInitialPrompt(DEFAULT_GLOSSARY)).toBe('');
  });

  it('joins terms with the JA ideographic comma', () => {
    expect(buildInitialPrompt(['明治ホールディングス', '管理会計'])).toBe(
      '明治ホールディングス、管理会計',
    );
  });

  it('trims, drops blanks, and de-duplicates (first wins)', () => {
    expect(buildInitialPrompt(['  Lisna ', '', '   ', 'Lisna', 'Whisper'])).toBe(
      'Lisna、Whisper',
    );
  });
});

describe('parseGlossary', () => {
  it('keeps non-empty trimmed strings in order', () => {
    expect(parseGlossary([' A ', 'B', ''])).toEqual(['A', 'B']);
  });

  it('non-array / wrong-shape input → [] (optional, never fatal)', () => {
    expect(parseGlossary(null)).toEqual([]);
    expect(parseGlossary('A,B')).toEqual([]);
    expect(parseGlossary({ terms: ['A'] })).toEqual([]);
    expect(parseGlossary([1, 'A', false, 'B'])).toEqual(['A', 'B']);
  });
});
