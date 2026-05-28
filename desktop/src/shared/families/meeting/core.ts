import { registerFamilyCore, type FamilyCoreDefinition } from '@shared/families';
import { MeetingNoteSchema, type MeetingNote } from './schema';
import { meetingPromptsV1 } from './prompts/v1';
import { meetingMergeStrategy } from './merge';
import { meetingMigrations } from './migrations';

export const MeetingFamilyCore: FamilyCoreDefinition<MeetingNote> = {
  id: 'meeting',
  schema: MeetingNoteSchema,
  prompts: [meetingPromptsV1],
  defaultPromptVariant: 'meeting-v1',
  picker: {
    labelKey: 'family.meeting.label',
    iconPath: 'icons/meeting.svg',          // resolved by renderer at render time
    descriptionKey: 'family.meeting.description',
    visibility: 'production',
  },
  evalBaselines: [],                          // eval lane (Plan 7) registers meeting/synth-v0
  requiresDiarization: true,                  // Meeting is multi-speaker — orchestrator runs/consumes diarization
  // No `slots` — Meeting's decisions/proposals/etc. are first-class fields, not an extras-slot system.
  mergeStrategy: meetingMergeStrategy,
  migrations: meetingMigrations,
};

registerFamilyCore(MeetingFamilyCore);
