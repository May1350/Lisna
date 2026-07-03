import { describe, it, expect } from 'vitest';
import {
  normalizeGlossary,
  MAX_GLOSSARY_TERMS,
  MAX_TERM_LEN,
  buildInitialPrompt,
  suggestGlossaryTerms,
} from './glossary';

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

describe('suggestGlossaryTerms', () => {
  const s = (before: string, after: string, existing: string[] = []) =>
    suggestGlossaryTerms([{ before, after }], existing);

  it('extracts a corrected katakana proper noun (the real アグリテック case)', () => {
    // STT mis-heard アグリテック as アグリック; the user fixes it.
    expect(s('今日はアグリックの話です', '今日はアグリテックの話です')).toEqual(['アグリテック']);
  });

  it('extracts a Latin / product-name run', () => {
    expect(s('アイオーエスのアプリ', 'iOSのアプリ')).toEqual(['iOS']);
  });

  it('keeps a hyphenated product name whole (K-LMS)', () => {
    expect(s('けいえるえむえすにログイン', 'K-LMSにログイン')).toEqual(['K-LMS']);
  });

  it('does NOT extract kanji (no NER; confirm-UI covers the miss)', () => {
    expect(s('たなかさんです', '田中さんです')).toEqual([]);
  });

  it('does NOT extract hiragana runs', () => {
    expect(s('あ', 'ありがとう')).toEqual([]);
  });

  it('ignores runs unchanged from before (already in the segment)', () => {
    expect(s('マイクのテスト', 'マイクのテストです')).toEqual([]);
  });

  it('excludes terms already in the glossary', () => {
    expect(s('今日はアグリックの話', '今日はアグリテックの話', ['アグリテック'])).toEqual([]);
  });

  it('excludes single-character Latin (too short to be a term)', () => {
    expect(s('a', 'a店で買った')).toEqual([]); // lone "a" is noise
  });

  it('dedups across segments and drops punctuation-only katakana runs', () => {
    const out = suggestGlossaryTerms(
      [
        { before: '前半', after: 'アグリテックの話' },
        { before: '後半', after: 'アグリテックをもう一度' }, // same term again
        { before: 'x', after: '・・・' }, // punctuation-only → dropped
      ],
      [],
    );
    expect(out).toEqual(['アグリテック']);
  });

  it('caps an over-long run at MAX_TERM_LEN', () => {
    const long = 'ア'.repeat(MAX_TERM_LEN + 5);
    expect(s('x', `${long}です`)).toEqual([]);
  });

  it('keeps a full katakana name joined across the middle dot', () => {
    expect(s('すてぃーぶ', 'スティーブ・ジョブズが登壇')).toEqual(['スティーブ・ジョブズ']);
  });

  it('returns [] when nothing changed', () => {
    expect(s('同じ文です', '同じ文です')).toEqual([]);
  });
});
