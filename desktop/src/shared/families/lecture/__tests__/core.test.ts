import { describe, it, expect } from 'vitest';
import { familyCoreRegistry } from '@shared/families';
import '../core';                                       // side-effect register

describe('Lecture family core registration', () => {
  it('registers under id "lecture"', () => {
    const fam = familyCoreRegistry['lecture'];
    expect(fam).toBeDefined();
    expect(fam!.id).toBe('lecture');
  });

  it('marks requiresDiarization: false (single-speaker)', () => {
    const fam = familyCoreRegistry['lecture']!;
    expect(fam.requiresDiarization).toBe(false);
  });

  it('exposes 4 slots in canonical order', () => {
    const fam = familyCoreRegistry['lecture']!;
    expect(fam.slots).toBeDefined();
    expect(fam.slots!.map((s) => s.type)).toEqual([
      'procedure_steps', 'argument_chain', 'formula', 'timeline',
    ]);
  });

  it('exposes schema + default prompt variant id + placeholder merge', () => {
    const fam = familyCoreRegistry['lecture']!;
    expect(fam.schema).toBeDefined();
    expect(fam.defaultPromptVariant).toBe('lecture-v1');
    expect(fam.prompts.find((p) => p.variantId === 'lecture-v1')).toBeDefined();
    expect(fam.mergeStrategy.scalarPolicy).toBe('longest');
    expect(fam.mergeStrategy.arrayPolicy).toBe('concat-dedup');
  });

  it('picker config has i18n keys + production visibility', () => {
    const fam = familyCoreRegistry['lecture']!;
    expect(fam.picker.labelKey).toBe('family.lecture.label');
    expect(fam.picker.descriptionKey).toBe('family.lecture.description');
    expect(fam.picker.visibility).toBe('production');
  });

  it('evalBaselines is an empty array (Plan 7 Task 14 registers baselines)', () => {
    const fam = familyCoreRegistry['lecture']!;
    expect(fam.evalBaselines).toEqual([]);
  });
});
