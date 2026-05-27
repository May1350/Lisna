import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { selectPromptVariant, type PromptVariant } from '../prompts';

const VARIANTS: PromptVariant[] = [
  {
    version: 1,
    variantId: 'v1-baseline',
    systemTemplate: 'sys',
    chunkUserTemplate: ({ transcript }) => `user ${transcript}`,
    mergeUserTemplate: ({ partials }) => `merge ${partials.length}`,
    recommendedTemp: 0.4,
    notes: 'baseline',
  },
  {
    version: 2,
    variantId: 'v2-experimental',
    systemTemplate: 'sys2',
    chunkUserTemplate: ({ transcript }) => `user2 ${transcript}`,
    mergeUserTemplate: ({ partials }) => `merge2 ${partials.length}`,
    recommendedTemp: 0.5,
    notes: 'experimental',
  },
];

describe('selectPromptVariant', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns family default when no env, no pref', () => {
    const v = selectPromptVariant(VARIANTS, 'v1-baseline');
    expect(v.variantId).toBe('v1-baseline');
  });

  it('user preference overrides default', () => {
    const v = selectPromptVariant(VARIANTS, 'v1-baseline', {
      userPreference: 'v2-experimental',
    });
    expect(v.variantId).toBe('v2-experimental');
  });

  it('env var overrides user preference', () => {
    vi.stubEnv('LISNA_PROMPT_VARIANT', 'v2-experimental');
    const v = selectPromptVariant(VARIANTS, 'v1-baseline', {
      userPreference: 'v1-baseline',
    });
    expect(v.variantId).toBe('v2-experimental');
  });

  it('throws on unknown variantId', () => {
    expect(() => selectPromptVariant(VARIANTS, 'no-such')).toThrow();
  });

  it('falls back to default when env-specified variant does not exist', () => {
    vi.stubEnv('LISNA_PROMPT_VARIANT', 'phantom-variant');
    const v = selectPromptVariant(VARIANTS, 'v1-baseline');
    expect(v.variantId).toBe('v1-baseline');
  });
});
