import { describe, it, expect } from 'vitest';
import { languageCapabilities } from '../language-capabilities';

describe('languageCapabilities', () => {
  it('ja/en support both transcript and notes', () => {
    expect(languageCapabilities('ja')).toEqual({ transcript: true, notes: true });
    expect(languageCapabilities('en')).toEqual({ transcript: true, notes: true });
  });
  it('ko is transcript-only in Phase 1 (notes deferred)', () => {
    expect(languageCapabilities('ko')).toEqual({ transcript: true, notes: false });
  });
  it('zh and unknown codes are fully unsupported', () => {
    expect(languageCapabilities('zh')).toEqual({ transcript: false, notes: false });
    expect(languageCapabilities('xx')).toEqual({ transcript: false, notes: false });
    expect(languageCapabilities('')).toEqual({ transcript: false, notes: false });
  });
});
