import { describe, it, expect } from 'vitest';
import { DEFAULT_STT_MODEL, DEFAULT_LLM_MODEL, DEFAULT_MODELS } from '../catalog';

const SHA256_RE = /^[0-9a-f]{64}$/;

describe('default model catalog', () => {
  it('default STT is large-v3-turbo, not the retired kotoba model', () => {
    expect(DEFAULT_STT_MODEL.kind).toBe('stt');
    expect(DEFAULT_STT_MODEL.filename).toBe('ggml-large-v3-turbo-q5_0.bin');
    // Regression guard for the 2026-06-15 swap: kotoba must not creep back in.
    expect(DEFAULT_STT_MODEL.filename).not.toMatch(/kotoba/i);
  });

  it('STT descriptor carries a real sha256 + non-zero size + HF source', () => {
    expect(DEFAULT_STT_MODEL.sha256).toMatch(SHA256_RE);
    expect(DEFAULT_STT_MODEL.sizeBytes).toBeGreaterThan(0);
    expect(DEFAULT_STT_MODEL.source.url).toMatch(/^https:\/\/huggingface\.co\//);
  });

  it('turbo is multilingual — no single language pinned', () => {
    // large-v3-turbo is multilingual; a pinned `language` would misrepresent it.
    expect(DEFAULT_STT_MODEL.language).toBeUndefined();
  });

  it('default LLM descriptor is well-formed', () => {
    expect(DEFAULT_LLM_MODEL.kind).toBe('llm');
    expect(DEFAULT_LLM_MODEL.sha256).toMatch(SHA256_RE);
    expect(DEFAULT_LLM_MODEL.sizeBytes).toBeGreaterThan(0);
    expect(DEFAULT_LLM_MODEL.source.url).toMatch(/^https:\/\/huggingface\.co\//);
  });

  it('DEFAULT_MODELS keys each slot by kind', () => {
    expect(DEFAULT_MODELS.stt).toBe(DEFAULT_STT_MODEL);
    expect(DEFAULT_MODELS.llm).toBe(DEFAULT_LLM_MODEL);
  });
});
