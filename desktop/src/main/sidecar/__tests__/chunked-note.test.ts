import { describe, it, expect } from 'vitest';
import { mergeChunkNotes, splitTextHalf } from '../chunked-note';

describe('mergeChunkNotes', () => {
  it('returns the single note unchanged when given one chunk', () => {
    expect(mergeChunkNotes(['【要点】\n・あ'])).toBe('【要点】\n・あ');
  });

  it('groups bullets under one header across chunks (first-seen order)', () => {
    const merged = mergeChunkNotes([
      '【要点】\n・point1\n【決定事項】\n・dec1',
      '【要点】\n・point2',
    ]);
    expect(merged.match(/【要点】/g)).toHaveLength(1);
    expect(merged).toContain('・point1');
    expect(merged).toContain('・point2');
    expect(merged).toContain('【決定事項】');
    expect(merged).toContain('・dec1');
    expect(merged.indexOf('【要点】')).toBeLessThan(merged.indexOf('【決定事項】'));
  });

  it('raw-concatenates losslessly when NO chunk has a recognizable header', () => {
    const merged = mergeChunkNotes(['just prose A', 'just prose B']);
    expect(merged).toContain('just prose A');
    expect(merged).toContain('just prose B');
  });

  it('attaches preamble (lines before first header) to the first section', () => {
    const merged = mergeChunkNotes([
      'intro line\n【要点】\n・p1',
      '【要点】\n・p2',
    ]);
    expect(merged).toContain('intro line');
    expect(merged).toContain('・p1');
    expect(merged).toContain('・p2');
    expect(merged.match(/【要点】/g)).toHaveLength(1);
  });

  it('drops empty/whitespace chunk outputs', () => {
    expect(mergeChunkNotes(['', '   ', '【要点】\n・only'])).toBe('【要点】\n・only');
    expect(mergeChunkNotes(['', '  '])).toBe('');
  });
});

describe('splitTextHalf', () => {
  it('splits on sentence boundary near the middle', () => {
    expect(splitTextHalf('一文目。二文目。三文目。四文目。')).toEqual([
      '一文目。二文目。',
      '三文目。四文目。',
    ]);
  });

  it('falls back to char midpoint when there is no sentence boundary', () => {
    expect(splitTextHalf('abcdef')).toEqual(['abc', 'def']);
  });

  it('returns a single element for trivially short text', () => {
    expect(splitTextHalf('あ')).toEqual(['あ']);
  });
});
