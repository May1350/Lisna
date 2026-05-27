import { registerFamilyCore, type FamilyCoreDefinition } from '@shared/families';
import type { MergeStrategy } from '@shared/families';
import { LectureNoteSchema, type LectureNote } from './schema';
import { LECTURE_SLOTS } from './slots';
import { lecturePromptsV1 } from './prompts/v1';

// Placeholder MergeStrategy — Task 6 lands the real concat-dedup + sections
// concat-only strategy per spec §5.2b. This stub matches the type and lets
// downstream code (orchestrator Task 9) read the field shape.
const lectureMergeStub: MergeStrategy = {
  scalarPolicy: 'longest',
  arrayPolicy: 'concat-dedup',
  sortByTs: true,
};

export const LectureFamilyCore: FamilyCoreDefinition<LectureNote> = {
  id: 'lecture',
  schema: LectureNoteSchema,
  prompts: [lecturePromptsV1],
  defaultPromptVariant: 'lecture-v1',
  picker: {
    labelKey: 'family.lecture.label',
    iconPath: 'icons/lecture.svg',          // resolved by renderer at render time
    descriptionKey: 'family.lecture.description',
    visibility: 'production',
  },
  evalBaselines: [],                         // Plan 7 Task 14 registers spike-0.2-v0 baseline
  requiresDiarization: false,                // single-speaker; orchestrator skips diarization
  slots: LECTURE_SLOTS,
  mergeStrategy: lectureMergeStub,
};

registerFamilyCore(LectureFamilyCore);
