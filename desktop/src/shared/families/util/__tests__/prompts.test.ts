import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { selectPromptVariant, renderSystemTemplate, type PromptVariant } from '../prompts';
import { lecturePromptsV1 } from '../../lecture/prompts';
import { meetingPromptsV1 } from '../../meeting/prompts';
import { interviewPromptsV1 } from '../../interview/prompts';
import { brainstormPromptsV1 } from '../../brainstorm/prompts';

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

// ── renderSystemTemplate — minimal EN support (2026-06-10) ──────────────────
// v2.0 prompts were authored + eval'd as JA-only. The renderer keeps the JA
// output BYTE-IDENTICAL (no eval-baseline drift) and only rewrites for other
// languages: swap the "MUST be Japanese" rule line when present
// (lecture/meeting EN-text prompts), append an explicit override when the
// whole prompt is JA-native (interview/brainstorm).
describe('renderSystemTemplate', () => {
  it('ja: returns the template byte-identical for ALL four family prompts', () => {
    for (const p of [lecturePromptsV1, meetingPromptsV1, interviewPromptsV1, brainstormPromptsV1]) {
      expect(renderSystemTemplate(p.systemTemplate, 'ja')).toBe(p.systemTemplate);
    }
  });

  it('en: swaps the Japanese rule line in the lecture prompt', () => {
    const out = renderSystemTemplate(lecturePromptsV1.systemTemplate, 'en');
    expect(out).not.toContain('MUST be Japanese');
    expect(out).toContain('MUST be English');
    // The rest of the prompt is intact (anti-parroting rule survives).
    expect(out).toContain('anti-parroting');
  });

  it('en: swaps the Japanese rule line in the meeting prompt', () => {
    const out = renderSystemTemplate(meetingPromptsV1.systemTemplate, 'en');
    expect(out).not.toContain('text in the JSON MUST be Japanese');
    expect(out).toContain('MUST be English');
  });

  it('en: appends an explicit override to JA-native prompts (interview/brainstorm)', () => {
    for (const p of [interviewPromptsV1, brainstormPromptsV1]) {
      const out = renderSystemTemplate(p.systemTemplate, 'en');
      expect(out.startsWith(p.systemTemplate)).toBe(true);  // original preserved
      expect(out).toContain('LANGUAGE OVERRIDE');
      expect(out).toContain('MUST be English');
    }
  });

  it('ko/zh: same mechanism, language-appropriate rule', () => {
    const ko = renderSystemTemplate(lecturePromptsV1.systemTemplate, 'ko');
    expect(ko).toContain('MUST be Korean');
    const zh = renderSystemTemplate(brainstormPromptsV1.systemTemplate, 'zh');
    expect(zh).toContain('MUST be Chinese');
  });
});
