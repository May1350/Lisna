/**
 * lecture-v2 prompt contract tests (EN-flip fix, 2026-06-13).
 *
 * Pins the defects that caused full-English output on a JA accounting lecture
 * (jaRatio 0.05):
 *   1. English-authored system prompt — primed EN continuation.
 *   2. English JA directive with a loophole ("unless the lecture itself uses
 *      English or romanized loanwords") licensed full-English output.
 *   3. English user-template tail ("Produce the LectureNote JSON") — last
 *      prose before generation primed EN continuation.
 *
 * Real grounding behavior is validated via scripts/note-quality-eval.ts
 * (real-3B, dump-replay) — not unit-testable here.
 */
import { describe, it, expect } from 'vitest';
import { lecturePromptsV2 } from '../prompts/v2';
import { LectureFamilyCore } from '../core';

describe('lecturePromptsV2 — prompt contract', () => {
  const chunkCtx = { chunkIndex: 0, totalChunks: 1, transcript: '[00:01] テスト講義' };

  it('has the correct variantId + version', () => {
    expect(lecturePromptsV2.variantId).toBe('lecture-v2');
    expect(lecturePromptsV2.version).toBe(2);
  });

  it('is registered in the family core alongside v1', () => {
    const ids = LectureFamilyCore.prompts.map((p) => p.variantId);
    expect(ids).toContain('lecture-v1');
    expect(ids).toContain('lecture-v2');
  });

  it('lecture-v2 is the default prompt variant', () => {
    expect(LectureFamilyCore.defaultPromptVariant).toBe('lecture-v2');
  });

  it('system template is JA-native: carries 最重要ルール block', () => {
    const s = lecturePromptsV2.systemTemplate;
    expect(s).toContain('最重要ルール');
    expect(s).toMatch(/必ず日本語で書くこと/);
    expect(s).toMatch(/英語の文章を出力してはいけません/);
  });

  it('system template grounds output in transcript (捏造 ban)', () => {
    expect(lecturePromptsV2.systemTemplate).toMatch(/捏造/);
  });

  it('system template preserves slot-hint injection (SLOT_HINTS must appear)', () => {
    // SLOT_HINTS joins all 4 slot types — spot-check that formula promptHint is present
    // (pitfalls.md llm-sanitize: LaTeX allowance depends on the prompt inviting LaTeX)
    expect(lecturePromptsV2.systemTemplate).toContain('formula');
    expect(lecturePromptsV2.systemTemplate).toContain('LaTeX');
  });

  it('system template preserves all 4 slot types', () => {
    for (const type of ['procedure_steps', 'argument_chain', 'formula', 'timeline']) {
      expect(lecturePromptsV2.systemTemplate).toContain(type);
    }
  });

  it('system template retains anti-parroting (E=mc^2 / F=ma ban)', () => {
    const s = lecturePromptsV2.systemTemplate;
    // These exemplars appear ONLY in the negative (forbidden list), not as positive examples.
    expect(s).toContain('E=mc^2');
    expect(s).toContain('F=ma');
    // They must appear near a prohibition word
    const emcIdx = s.indexOf('E=mc^2');
    const context = s.slice(Math.max(0, emcIdx - 100), emcIdx);
    expect(context).toMatch(/プレースホルダ|NEVER|禁止/);
  });

  it('chunk template tail is Japanese — no English instruction sentence priming EN continuation', () => {
    const rendered = lecturePromptsV2.chunkUserTemplate(chunkCtx);
    // Must NOT end with the v1 English tail
    expect(rendered).not.toContain('Produce the LectureNote JSON');
    // Must demand Japanese strings + JSON-only in JA
    const tail = rendered.slice(rendered.indexOf('テスト講義'));
    expect(tail).toMatch(/日本語/);
    expect(tail).toMatch(/JSON のみ/);
  });

  it('chunk template includes the transcript', () => {
    const rendered = lecturePromptsV2.chunkUserTemplate(chunkCtx);
    expect(rendered).toContain('[00:01] テスト講義');
    expect(rendered).toContain('Chunk 1 of 1');
  });

  it('chunk template multi-chunk numbering', () => {
    const rendered = lecturePromptsV2.chunkUserTemplate({ chunkIndex: 2, totalChunks: 5, transcript: 'x' });
    expect(rendered).toContain('Chunk 3 of 5');
  });

  it('mergeUserTemplate is absent (Lecture uses deterministic merge)', () => {
    expect(lecturePromptsV2.mergeUserTemplate).toBeUndefined();
  });

  it('recommendedTemp is 0.4', () => {
    expect(lecturePromptsV2.recommendedTemp).toBe(0.4);
  });
});
