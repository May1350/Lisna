import { registerFamilyCore, type FamilyCoreDefinition } from '@shared/families';
import { BrainstormNoteSchema, type BrainstormNote } from './schema';
import { brainstormPromptsV1 } from './prompts/v1';
import { brainstormMergeStrategy } from './merge';
import { brainstormMigrations } from './migrations';

export const BrainstormFamilyCore: FamilyCoreDefinition<BrainstormNote> = {
  id: 'brainstorm',
  schema: BrainstormNoteSchema,
  prompts: [brainstormPromptsV1],
  defaultPromptVariant: 'brainstorm-v1',
  picker: {
    labelKey: 'family.brainstorm.label',
    iconPath: 'icons/brainstorm.svg',          // resolved by renderer at render time
    descriptionKey: 'family.brainstorm.description',
    visibility: 'production',
  },
  evalBaselines: [],
  requiresDiarization: false,                   // treated single-speaker; orchestrator skips diarization
  mergeStrategy: brainstormMergeStrategy,
  migrations: brainstormMigrations,
};

registerFamilyCore(BrainstormFamilyCore);
