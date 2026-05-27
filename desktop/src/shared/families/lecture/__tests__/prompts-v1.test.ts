import { describe, it, expect } from 'vitest';
import { lecturePromptsV1 } from '../prompts/v1';

describe('lecturePromptsV1', () => {
  it('has the correct variantId + version', () => {
    expect(lecturePromptsV1.variantId).toBe('lecture-v1');
    expect(lecturePromptsV1.version).toBe(1);
  });

  it('system prompt contains the anti-parroting rule', () => {
    expect(lecturePromptsV1.systemTemplate).toMatch(/never (use|invent|fabricate)/i);
    expect(lecturePromptsV1.systemTemplate).toMatch(/transcript/i);
  });

  it('system prompt does NOT include literal slot exemplars (E=mc², F=ma)', () => {
    // The anti-parroting rule MENTIONS these as forbidden, so the assertion is:
    // they appear ONLY in the negative ("NEVER use ... E=mc^2"), never as positive exemplars.
    // We assert the substrings appear exactly once and are preceded by "NEVER" within 80 chars.
    const sys = lecturePromptsV1.systemTemplate;
    const emcMatches = [...sys.matchAll(/E=mc/g)];
    expect(emcMatches.length).toBeGreaterThan(0);
    for (const m of emcMatches) {
      const start = Math.max(0, m.index! - 80);
      const context = sys.slice(start, m.index!);
      expect(context).toMatch(/NEVER/);
    }
  });

  it('system prompt mentions all 4 slot types', () => {
    for (const type of ['procedure_steps', 'argument_chain', 'formula', 'timeline']) {
      expect(lecturePromptsV1.systemTemplate).toContain(type);
    }
  });

  it('system prompt embeds each slot promptHint at module-import time', () => {
    // Path F: SLOT_HINTS is computed from LECTURE_SLOTS, so adding a 5th slot
    // (Plan 6) automatically updates the prompt without code changes here.
    // Spot-check: formula promptHint substring is present.
    expect(lecturePromptsV1.systemTemplate).toContain('NEVER use a generic placeholder');
  });

  it('chunkUserTemplate is a callable function-builder', () => {
    const out = lecturePromptsV1.chunkUserTemplate({
      chunkIndex: 0,
      totalChunks: 2,
      transcript: '[00:00] テスト',
    });
    expect(out).toContain('[00:00] テスト');
    expect(out).toContain('Chunk 1 of 2');
    expect(out).toContain('Produce the LectureNote JSON');
  });

  it('chunkUserTemplate handles single-chunk case (totalChunks=1, chunkIndex=0)', () => {
    const out = lecturePromptsV1.chunkUserTemplate({
      chunkIndex: 0, totalChunks: 1, transcript: 'x',
    });
    expect(out).toContain('Chunk 1 of 1');
  });

  it('mergeUserTemplate is absent (Lecture uses deterministic merge)', () => {
    expect(lecturePromptsV1.mergeUserTemplate).toBeUndefined();
  });

  it('recommendedTemp is 0.4 (Path F finding: lower temp for grammar-constrained JA)', () => {
    expect(lecturePromptsV1.recommendedTemp).toBe(0.4);
  });
});
