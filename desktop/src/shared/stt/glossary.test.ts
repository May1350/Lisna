import { describe, it, expect } from 'vitest';
import { normalizeGlossary, MAX_GLOSSARY_TERMS, MAX_TERM_LEN, buildInitialPrompt } from './glossary';

describe('normalizeGlossary', () => {
  it('trims, drops empty, de-dupes first-wins', () => {
    expect(normalizeGlossary(['  A ', 'A', '', '  ', 'B', 'A'])).toEqual(['A', 'B']);
  });

  it('drops terms longer than MAX_TERM_LEN', () => {
    const longTerm = 'あ'.repeat(MAX_TERM_LEN + 1);
    expect(normalizeGlossary(['ok', longTerm])).toEqual(['ok']);
    expect(normalizeGlossary(['あ'.repeat(MAX_TERM_LEN)])).toHaveLength(1); // exactly at cap is kept
  });

  it('caps the list to MAX_GLOSSARY_TERMS (protects the ~224-token initial_prompt budget)', () => {
    const many = Array.from({ length: MAX_GLOSSARY_TERMS + 20 }, (_, i) => `t${i}`);
    expect(normalizeGlossary(many)).toHaveLength(MAX_GLOSSARY_TERMS);
  });

  it('feeds buildInitialPrompt cleanly (joined with 、)', () => {
    expect(buildInitialPrompt(normalizeGlossary(['田中', '佐藤']))).toBe('田中、佐藤');
  });
});
