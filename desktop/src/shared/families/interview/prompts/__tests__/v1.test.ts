import { describe, it, expect } from 'vitest';
import { interviewPromptsV1 } from '../v1';
import type { ChunkContext, MergeContext } from '../../../util/prompts';

describe('interviewPromptsV1', () => {
  it('has correct identity fields', () => {
    expect(interviewPromptsV1.variantId).toBe('interview-v1');
    expect(interviewPromptsV1.version).toBe(1);
    expect(interviewPromptsV1.recommendedTemp).toBe(0.4);
  });

  describe('systemTemplate', () => {
    const { systemTemplate } = interviewPromptsV1;
    it('instructs JA output', () => { expect(systemTemplate).toMatch(/日本語/); });
    it('has anti-parroting instruction', () => { expect(systemTemplate).toMatch(/creative writing 禁止|捏造/); });
    it('mentions interviewer / interviewee role assignment', () => {
      expect(systemTemplate).toMatch(/interviewer[\s\S]*interviewee|質問者[\s\S]*回答者/);
    });
    it('mentions .max budget hints (qa_pairs, themes)', () => {
      expect(systemTemplate).toMatch(/qa_pairs[\s\S]*80/);
      expect(systemTemplate).toMatch(/themes[\s\S]*12/);
    });
    it('does NOT contain the section-sign character', () => { expect(systemTemplate).not.toContain('§'); });
  });

  describe('chunkUserTemplate (function)', () => {
    it('embeds transcript + chunk position', () => {
      const ctx: ChunkContext = { chunkIndex: 0, totalChunks: 2, transcript: '[00:00] [0] テスト質問' };
      const result = interviewPromptsV1.chunkUserTemplate(ctx);
      expect(result).toContain('[00:00] [0] テスト質問');
      expect(result).toContain('Chunk 1 of 2');
      expect(result).toMatch(/InterviewNote/);
    });
  });

  describe('mergeUserTemplate (function)', () => {
    it('is defined (Interview uses merge-llm for themes)', () => {
      expect(interviewPromptsV1.mergeUserTemplate).toBeDefined();
    });
    it('embeds the partials', () => {
      const ctx: MergeContext = { partials: [{ family: 'interview', purpose: 'p' }] };
      const result = interviewPromptsV1.mergeUserTemplate!(ctx);
      expect(result).toContain('interview');
      expect(result).toMatch(/InterviewNote/);
    });
  });
});
