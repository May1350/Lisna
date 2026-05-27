// desktop/eval/judges/llm-judge.test.ts
import { describe, it, expect } from 'vitest';
import { __testOnly_parseJudgeResponse, __testOnly_clamp } from './llm-judge';

describe('parseJudgeResponse — Lecture', () => {
  it('clamps out-of-range scores to [0, 10]', () => {
    const j = __testOnly_parseJudgeResponse('lecture', JSON.stringify({
      coverage: 12, accuracy: -2, hierarchy: 5, conciseness: 5, importance: 5,
      provenance: 5, sectionCoherence: 5, contentFidelity: 5,
      overall: 5, issues: ['x'], wins: ['y'],
    }));
    expect(j.axes.coverage).toBe(10);
    expect(j.axes.accuracy).toBe(0);
  });

  it('defaults missing axes to 0 (legacy/judge-omission safety)', () => {
    const j = __testOnly_parseJudgeResponse('lecture', '{}');
    expect(j.axes.coverage).toBe(0);
    expect(j.axes.contentFidelity).toBe(0);
  });

  it('filters non-string entries from issues/wins arrays', () => {
    const j = __testOnly_parseJudgeResponse('meeting', JSON.stringify({
      issues: ['valid', 123, null, 'also valid'],
      wins: 'not an array',
    }));
    expect(j.issues).toEqual(['valid', 'also valid']);
    expect(j.wins).toEqual([]);
  });

  it('handles malformed JSON by defaulting all axes to 0', () => {
    const j = __testOnly_parseJudgeResponse('lecture', 'not json at all');
    expect(j.axes.coverage).toBe(0);
    expect(j.axes.sectionCoherence).toBe(0);
    expect(j.overall).toBe(0);
    expect(j.issues).toEqual([]);
    expect(j.wins).toEqual([]);
  });

  it('populates the correct family axis keys per family', () => {
    const lecture = __testOnly_parseJudgeResponse('lecture', JSON.stringify({ sectionCoherence: 7, contentFidelity: 8 }));
    expect((lecture.axes as any).sectionCoherence).toBe(7);
    expect((lecture.axes as any).contentFidelity).toBe(8);

    const meeting = __testOnly_parseJudgeResponse('meeting', JSON.stringify({ decisionCapture: 9, actionItemClarity: 6, participantAttribution: 5 }));
    expect((meeting.axes as any).decisionCapture).toBe(9);
    expect((meeting.axes as any).participantAttribution).toBe(5);
  });
});

describe('clamp', () => {
  it('rounds to one decimal', () => {
    expect(__testOnly_clamp(5.5555)).toBe(5.6);
  });

  it('returns 0 for non-numeric input', () => {
    expect(__testOnly_clamp('not a number')).toBe(0);
    expect(__testOnly_clamp(NaN)).toBe(0);
    expect(__testOnly_clamp(undefined)).toBe(0);
  });

  it('clamps above 10 to 10 and below 0 to 0', () => {
    expect(__testOnly_clamp(100)).toBe(10);
    expect(__testOnly_clamp(-5)).toBe(0);
  });
});
