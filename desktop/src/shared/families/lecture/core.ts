import { registerFamilyCore, type FamilyCoreDefinition } from '@shared/families';
import { LectureNoteSchema, type LectureNote } from './schema';
import { LECTURE_SLOTS } from './slots';
import { lecturePromptsV1 } from './prompts/v1';
import { lecturePromptsV2 } from './prompts/v2';
import { lectureMergeStrategy } from './merge';
import { lectureMigrations } from './migrations';

export const LectureFamilyCore: FamilyCoreDefinition<LectureNote> = {
  id: 'lecture',
  schema: LectureNoteSchema,
  prompts: [lecturePromptsV1, lecturePromptsV2],
  defaultPromptVariant: 'lecture-v2',
  picker: {
    labelKey: 'family.lecture.label',
    iconPath: 'icons/lecture.svg',          // resolved by renderer at render time
    descriptionKey: 'family.lecture.description',
    visibility: 'production',
  },
  evalBaselines: [],                         // Plan 7 Task 14 registers spike-0.2-v0 baseline
  requiresDiarization: false,                // single-speaker; orchestrator skips diarization
  slots: LECTURE_SLOTS,
  mergeStrategy: lectureMergeStrategy,
  migrations: lectureMigrations,
};

registerFamilyCore(LectureFamilyCore);
