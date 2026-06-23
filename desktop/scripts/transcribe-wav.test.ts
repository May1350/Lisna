import { describe, it, expect } from 'vitest';
import { __testOnly_parseArgs } from './transcribe-wav';

describe('transcribe-wav parseArgs', () => {
  it('defaults to ja and no wav path', () => {
    const o = __testOnly_parseArgs(['node', 'transcribe-wav.ts']);
    expect(o.lang).toBe('ja');
    expect(o.wavPath).toBeUndefined();
  });

  it('takes the first non-flag token as the wav path', () => {
    const o = __testOnly_parseArgs(['node', 'transcribe-wav.ts', '/tmp/clip.wav']);
    expect(o.wavPath).toBe('/tmp/clip.wav');
    expect(o.lang).toBe('ja');
  });

  it('parses --lang ko (Korean acceptance run)', () => {
    const o = __testOnly_parseArgs(['node', 'transcribe-wav.ts', '--lang', 'ko', '/tmp/ko.wav']);
    expect(o.lang).toBe('ko');
    expect(o.wavPath).toBe('/tmp/ko.wav');
  });

  it('accepts --language as an alias and flag-before-path or path-before-flag', () => {
    expect(__testOnly_parseArgs(['node', 't.ts', '/tmp/a.wav', '--language', 'en']).lang).toBe('en');
    expect(__testOnly_parseArgs(['node', 't.ts', '--language', 'en', '/tmp/a.wav']).wavPath).toBe('/tmp/a.wav');
  });

  it('throws on an unknown language code (typo fails loud)', () => {
    expect(() => __testOnly_parseArgs(['node', 't.ts', '--lang', 'kr', '/tmp/a.wav'])).toThrow(/--lang must be one of/);
  });

  it('throws when --lang has no value', () => {
    expect(() => __testOnly_parseArgs(['node', 't.ts', '--lang'])).toThrow(/--lang must be one of/);
  });
});
