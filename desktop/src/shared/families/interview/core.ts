import { registerFamilyCore, type FamilyCoreDefinition } from '@shared/families';
import { InterviewNoteSchema, type InterviewNote } from './schema';
import { interviewPromptsV1 } from './prompts/v1';
import { interviewMergeStrategy } from './merge';
import { interviewMigrations } from './migrations';

export const InterviewFamilyCore: FamilyCoreDefinition<InterviewNote> = {
  id: 'interview',
  schema: InterviewNoteSchema,
  prompts: [interviewPromptsV1],
  defaultPromptVariant: 'interview-v1',
  picker: {
    labelKey: 'family.interview.label',
    iconPath: 'icons/interview.svg',          // resolved by renderer at render time
    descriptionKey: 'family.interview.description',
    visibility: 'production',
  },
  evalBaselines: [],                            // eval lane registers interview baseline later
  requiresDiarization: true,                    // interviewer + interviewee — multi-speaker
  mergeStrategy: interviewMergeStrategy,
  migrations: interviewMigrations,
};

registerFamilyCore(InterviewFamilyCore);
