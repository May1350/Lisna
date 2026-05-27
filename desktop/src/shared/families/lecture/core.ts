import { registerFamilyCore, type FamilyCoreDefinition } from '@shared/families';
import type { PromptVariant } from '@shared/families';
import type { MergeStrategy } from '@shared/families';
import { LectureNoteSchema, type LectureNote } from './schema';
import { LECTURE_SLOTS } from './slots';

// Placeholder PromptVariant — Task 4 lands the real v1 prompt with the
// anti-parroting rule + slot trigger hints. The shape matches Plan 2
// PromptVariant exactly so the family can be registered before prompts
// are authored, unblocking Tasks 5/6/7 that consume the registry.
const lecturePromptStub: PromptVariant = {
  version: 1,
  variantId: 'lecture-v1',
  systemTemplate: '',          // filled by Task 4
  chunkUserTemplate: '',       // filled by Task 4
  mergeUserTemplate: '',       // Lecture uses deterministic merge; stays empty
  recommendedTemp: 0.4,
  notes: 'Placeholder — real prompt lands in Plan 3 Task 4 (anti-parroting + slot hints).',
};

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
  prompts: [lecturePromptStub],
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
