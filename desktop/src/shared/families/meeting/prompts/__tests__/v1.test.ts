import { describe, it, expect } from 'vitest';
import { meetingPromptsV1 } from '../v1';
import type { ChunkContext } from '../../../util/prompts';

describe('meetingPromptsV1', () => {
  it('has correct identity fields', () => {
    expect(meetingPromptsV1.variantId).toBe('meeting-v1');
    expect(meetingPromptsV1.version).toBe(1);
    expect(meetingPromptsV1.recommendedTemp).toBe(0.4);
  });

  describe('systemTemplate', () => {
    const { systemTemplate } = meetingPromptsV1;

    it('contains anti-parroting rule', () => {
      expect(systemTemplate).toMatch(/never (invent|fabricate|use)/i);
    });

    it('does NOT contain canned exemplar strings', () => {
      expect(systemTemplate).not.toContain('田中が決定した');
      expect(systemTemplate).not.toContain('タスクA');
      expect(systemTemplate).not.toContain('次のステップを決定する');
    });

    it('contains all four semantic field names', () => {
      expect(systemTemplate).toMatch(/decision/i);
      expect(systemTemplate).toMatch(/conclusion/i);
      expect(systemTemplate).toMatch(/proposal/i);
      expect(systemTemplate).toMatch(/next_step/i);
    });

    it('contains JA trigger words for key slots', () => {
      expect(systemTemplate).toContain('合意');
      expect(systemTemplate).toContain('決定');
      expect(systemTemplate).toContain('タスク');
      expect(systemTemplate).toContain('参加者');
    });

    it('contains SpeakerRef / integer speaker instruction', () => {
      // Must mention SpeakerRef or the instruction to use an integer for speaker
      const hasSpeakerRef = systemTemplate.includes('SpeakerRef') || systemTemplate.includes('integer');
      expect(hasSpeakerRef).toBe(true);
    });

    it('does NOT contain the section-sign character', () => {
      expect(systemTemplate).not.toContain('§');
    });
  });

  describe('chunkUserTemplate', () => {
    it('embeds transcript and chunk position in output', () => {
      const ctx: ChunkContext = {
        chunkIndex: 0,
        totalChunks: 2,
        transcript: '[00:00] [佐藤] テスト',
      };
      const result = meetingPromptsV1.chunkUserTemplate(ctx);
      expect(result).toContain('[00:00] [佐藤] テスト');
      expect(result).toContain('Chunk 1 of 2');
      expect(result).toMatch(/MeetingNote/i);
    });

    it('accepts only ChunkContext (no speakers field)', () => {
      // TypeScript signature check — verify calling with plain ChunkContext works
      const ctx: ChunkContext = {
        chunkIndex: 1,
        totalChunks: 3,
        transcript: '[00:10] [山田] 議題',
      };
      expect(() => meetingPromptsV1.chunkUserTemplate(ctx)).not.toThrow();
    });
  });

  it('mergeUserTemplate is undefined (Meeting uses deterministic merge)', () => {
    expect(meetingPromptsV1.mergeUserTemplate).toBeUndefined();
  });
});
