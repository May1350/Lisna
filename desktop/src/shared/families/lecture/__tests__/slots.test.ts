import { describe, it, expect } from 'vitest';
import { LECTURE_SLOTS, LectureSlotInstanceSchema } from '../slots';

describe('LECTURE_SLOTS registry', () => {
  it('registers exactly 4 slots in canonical order', () => {
    expect(LECTURE_SLOTS).toHaveLength(4);
    expect(LECTURE_SLOTS.map((s) => s.type)).toEqual([
      'procedure_steps',
      'argument_chain',
      'formula',
      'timeline',
    ]);
  });
});

describe('LectureSlotInstanceSchema (discriminated union on `type`)', () => {
  it('parses a valid procedure_steps instance', () => {
    const inst = {
      type: 'procedure_steps',
      steps: [
        { order: 1, text: '材料を準備する', ts: 30, from: 'transcript' },
        { order: 2, text: '混ぜる', ts: 45, from: 'transcript' },
      ],
    };
    expect(() => LectureSlotInstanceSchema.parse(inst)).not.toThrow();
  });

  it('parses a valid formula instance with optional label + LaTeX expression', () => {
    const inst = {
      type: 'formula',
      expression: '\\nabla \\cdot E = \\rho / \\epsilon_0',
      label: 'ガウスの法則',
      ts: 120,
      from: 'transcript',
    };
    expect(() => LectureSlotInstanceSchema.parse(inst)).not.toThrow();
  });

  it('parses a valid argument_chain (min 2 claims)', () => {
    const inst = {
      type: 'argument_chain',
      claims: [
        { order: 1, text: 'P', ts: 0, from: 'transcript' },
        { order: 2, text: 'Q', ts: 5, from: 'transcript' },
      ],
    };
    expect(() => LectureSlotInstanceSchema.parse(inst)).not.toThrow();
  });

  it('parses a valid timeline (min 2 events)', () => {
    const inst = {
      type: 'timeline',
      events: [
        { when: '1991年', text: 'A', ts: 0, from: 'transcript' },
        { when: '1992年', text: 'B', ts: 5, from: 'transcript' },
      ],
    };
    expect(() => LectureSlotInstanceSchema.parse(inst)).not.toThrow();
  });

  it('rejects an unknown slot type', () => {
    expect(() =>
      LectureSlotInstanceSchema.parse({ type: 'mystery_meat', text: 'x' }),
    ).toThrow();
  });

  it('enforces .max(20) on procedure_steps.steps (Path G)', () => {
    const tooManySteps = {
      type: 'procedure_steps',
      steps: Array.from({ length: 21 }, (_, i) => ({
        order: i + 1, text: `step ${i + 1}`, ts: i, from: 'transcript',
      })),
    };
    expect(() => LectureSlotInstanceSchema.parse(tooManySteps)).toThrow(/steps/i);
  });

  it('enforces .min(1) on procedure_steps.steps (empty arrays invalid)', () => {
    expect(() =>
      LectureSlotInstanceSchema.parse({ type: 'procedure_steps', steps: [] }),
    ).toThrow();
  });
});
