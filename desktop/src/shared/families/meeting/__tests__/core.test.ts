import { describe, it, expect } from 'vitest';
import { familyCoreRegistry, selectPromptVariant } from '@shared/families';
import { MeetingNoteSchema } from '../schema';
import { meetingMergeStrategy } from '../merge';
import '../core';                                       // side-effect register

describe('Meeting family core registration', () => {
  it('registers under id "meeting"', () => {
    const fam = familyCoreRegistry['meeting'];
    expect(fam).toBeDefined();
    expect(fam!.id).toBe('meeting');
  });

  it('marks requiresDiarization: true (multi-speaker)', () => {
    const fam = familyCoreRegistry['meeting']!;
    expect(fam.requiresDiarization).toBe(true);
  });

  it('has no slots (Meeting uses first-class fields, not extras-slot system)', () => {
    const fam = familyCoreRegistry['meeting']!;
    expect(fam.slots).toBeUndefined();
  });

  it('exposes schema + default prompt variant id + resolvable variant', () => {
    const fam = familyCoreRegistry['meeting']!;
    expect(fam.schema).toBe(MeetingNoteSchema);
    expect(fam.defaultPromptVariant).toBe('meeting-v1');
    expect(selectPromptVariant(fam.prompts, fam.defaultPromptVariant)).toBeDefined();
  });

  it('mergeStrategy is the meetingMergeStrategy reference', () => {
    const fam = familyCoreRegistry['meeting']!;
    expect(fam.mergeStrategy).toBe(meetingMergeStrategy);
    expect(fam.mergeStrategy.scalarPolicy).toBe('longest');
    expect(fam.mergeStrategy.arrayPolicy).toBe('concat-dedup');
  });

  it('picker config has i18n keys + production visibility', () => {
    const fam = familyCoreRegistry['meeting']!;
    expect(fam.picker.labelKey).toBe('family.meeting.label');
    expect(fam.picker.descriptionKey).toBe('family.meeting.description');
    expect(fam.picker.visibility).toBe('production');
  });

  it('evalBaselines is an empty array (Plan 7 registers meeting/synth-v0)', () => {
    const fam = familyCoreRegistry['meeting']!;
    expect(fam.evalBaselines).toEqual([]);
  });

  it('migrations is an empty array (v1-only, no schema-version migrations yet)', () => {
    const fam = familyCoreRegistry['meeting']!;
    expect(fam.migrations).toEqual([]);
  });
});
