import { describe, it, expect } from 'vitest';
import { familyCoreRegistry, selectPromptVariant } from '@shared/families';
import { InterviewNoteSchema } from '../schema';
import { interviewMergeStrategy } from '../merge';
import '../core'; // side-effect register

describe('Interview family core registration', () => {
  it('registers under id "interview"', () => {
    const fam = familyCoreRegistry['interview'];
    expect(fam).toBeDefined();
    expect(fam!.id).toBe('interview');
  });
  it('marks requiresDiarization: true (interviewer + interviewee)', () => {
    expect(familyCoreRegistry['interview']!.requiresDiarization).toBe(true);
  });
  it('has no slots (Interview uses first-class fields)', () => {
    expect(familyCoreRegistry['interview']!.slots).toBeUndefined();
  });
  it('exposes schema + default prompt variant id + resolvable variant', () => {
    const fam = familyCoreRegistry['interview']!;
    expect(fam.schema).toBe(InterviewNoteSchema);
    expect(fam.defaultPromptVariant).toBe('interview-v1');
    expect(selectPromptVariant(fam.prompts, fam.defaultPromptVariant)).toBeDefined();
  });
  it('mergeStrategy: themes merge-llm + qa_pairs concat-only, default concat-dedup', () => {
    const fam = familyCoreRegistry['interview']!;
    expect(fam.mergeStrategy).toBe(interviewMergeStrategy);
    expect(fam.mergeStrategy.arrayPolicy).toBe('concat-dedup');
    expect(fam.mergeStrategy.fieldOverrides?.themes?.policy).toBe('merge-llm');
    expect(fam.mergeStrategy.fieldOverrides?.qa_pairs?.policy).toBe('concat-only');
  });
  it('picker config has i18n keys + production visibility', () => {
    const fam = familyCoreRegistry['interview']!;
    expect(fam.picker.labelKey).toBe('family.interview.label');
    expect(fam.picker.descriptionKey).toBe('family.interview.description');
    expect(fam.picker.visibility).toBe('production');
  });
  it('evalBaselines is an empty array', () => {
    expect(familyCoreRegistry['interview']!.evalBaselines).toEqual([]);
  });
  it('migrations is an empty array (v1-only)', () => {
    expect(familyCoreRegistry['interview']!.migrations).toEqual([]);
  });
});
