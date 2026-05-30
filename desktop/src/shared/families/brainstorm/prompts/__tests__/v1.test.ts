import { describe, it, expect } from 'vitest';
import { brainstormPromptsV1 } from '../v1';
import type { ChunkContext, MergeContext } from '../../../util/prompts';

describe('brainstormPromptsV1', () => {
  it('has correct identity fields', () => {
    expect(brainstormPromptsV1.variantId).toBe('brainstorm-v1');
    expect(brainstormPromptsV1.version).toBe(1);
    expect(brainstormPromptsV1.recommendedTemp).toBe(0.5);
  });

  describe('systemTemplate', () => {
    const { systemTemplate } = brainstormPromptsV1;
    it('instructs JA output', () => { expect(systemTemplate).toMatch(/日本語/); });
    it('has anti-parroting instruction', () => { expect(systemTemplate).toMatch(/creative writing 禁止|捏造/); });
    it('instructs argument-chain identification', () => { expect(systemTemplate).toMatch(/議論の流れ|argument chain/i); });
    it('instructs idea diversity (no paraphrase clustering)', () => { expect(systemTemplate).toMatch(/言い換え|多様性|diversity/i); });
    it('instructs cluster coherence (theme must explain its ideas)', () => { expect(systemTemplate).toMatch(/clusterCoherence|theme[\s\S]*ideas|テーマ/); });
    it('mentions .max budget (idea_clusters ≤ 15, ideas ≤ 30)', () => {
      expect(systemTemplate).toMatch(/idea_clusters[\s\S]*15/);
      expect(systemTemplate).toMatch(/ideas[\s\S]*30/);
    });
    it('instructs NOT to emit ideas[].id (post-decode hydration)', () => { expect(systemTemplate).toMatch(/id は出力に含めない|do not emit.*id/i); });
    it('does NOT contain the section-sign character', () => { expect(systemTemplate).not.toContain('§'); });
  });

  describe('chunkUserTemplate (function)', () => {
    it('embeds transcript + chunk position', () => {
      const ctx: ChunkContext = { chunkIndex: 1, totalChunks: 3, transcript: '[00:10] [0] アイデアX' };
      const result = brainstormPromptsV1.chunkUserTemplate(ctx);
      expect(result).toContain('[00:10] [0] アイデアX');
      expect(result).toContain('Chunk 2 of 3');
      expect(result).toMatch(/BrainstormNote/);
    });
  });

  describe('mergeUserTemplate (function)', () => {
    it('is defined (Brainstorm uses merge-llm for idea_clusters)', () => {
      expect(brainstormPromptsV1.mergeUserTemplate).toBeDefined();
    });
    it('embeds the partials', () => {
      const ctx: MergeContext = { partials: [{ family: 'brainstorm', purpose: 'p' }] };
      const result = brainstormPromptsV1.mergeUserTemplate!(ctx);
      expect(result).toContain('brainstorm');
      expect(result).toMatch(/BrainstormNote/);
    });
  });
});
