import { describe, it, expect } from 'vitest';
import { familyCoreRegistry, selectPromptVariant } from '@shared/families';
import { BrainstormNoteSchema } from '../schema';
import { brainstormMergeStrategy } from '../merge';
import '../core'; // side-effect register

describe('Brainstorm family core registration', () => {
  it('registers under id "brainstorm"', () => {
    const fam = familyCoreRegistry['brainstorm'];
    expect(fam).toBeDefined();
    expect(fam!.id).toBe('brainstorm');
  });
  it('marks requiresDiarization: false (treated single-speaker)', () => {
    expect(familyCoreRegistry['brainstorm']!.requiresDiarization).toBe(false);
  });
  it('has no slots (Brainstorm uses first-class fields)', () => {
    expect(familyCoreRegistry['brainstorm']!.slots).toBeUndefined();
  });
  it('exposes schema + default prompt variant id + resolvable variant', () => {
    const fam = familyCoreRegistry['brainstorm']!;
    expect(fam.schema).toBe(BrainstormNoteSchema);
    expect(fam.defaultPromptVariant).toBe('brainstorm-v1');
    expect(selectPromptVariant(fam.prompts, fam.defaultPromptVariant)).toBeDefined();
  });
  it('mergeStrategy: idea_clusters merge-llm, default arrayPolicy concat-only', () => {
    const fam = familyCoreRegistry['brainstorm']!;
    expect(fam.mergeStrategy).toBe(brainstormMergeStrategy);
    expect(fam.mergeStrategy.arrayPolicy).toBe('concat-only');
    expect(fam.mergeStrategy.fieldOverrides?.idea_clusters?.policy).toBe('merge-llm');
  });
  it('picker config has i18n keys + production visibility', () => {
    const fam = familyCoreRegistry['brainstorm']!;
    expect(fam.picker.labelKey).toBe('family.brainstorm.label');
    expect(fam.picker.descriptionKey).toBe('family.brainstorm.description');
    expect(fam.picker.visibility).toBe('production');
  });
  it('evalBaselines is an empty array', () => {
    expect(familyCoreRegistry['brainstorm']!.evalBaselines).toEqual([]);
  });
  it('migrations is an empty array (v1-only)', () => {
    expect(familyCoreRegistry['brainstorm']!.migrations).toEqual([]);
  });
});
