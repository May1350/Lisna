import type { z } from 'zod';
import type { ComponentType } from 'react';
import type { NoteBase, NoteFamily } from '@shared/note-schema/base';
import type { ProvenanceComputer } from '@shared/note-schema/provenance';
import type { PromptVariant } from './util/prompts';
import type { SlotDefinition } from './util/slot';

/** Per spec §5.2b. Per-family default strategies land in Plans 3-6 alongside each schema. */
export interface MergeStrategy {
  scalarPolicy: 'longest' | 'first' | 'merge-llm';
  arrayPolicy: 'concat-dedup' | 'merge-llm' | 'concat-only';
  sortByTs?: boolean;
  fieldOverrides?: {
    [field: string]: {
      policy: 'longest' | 'first' | 'concat-dedup' | 'concat-only' | 'merge-llm' | 'custom';
      handler?: (partials: unknown[]) => unknown;
    };
  };
}

/** Picker config — i18n keys, icon, visibility. Per spec §4 #8. */
export interface FamilyPickerConfig {
  labelKey: string;
  icon: ComponentType;
  descriptionKey: string;
  visibility: 'production' | 'experimental';
}

/**
 * The single binding point per family — schema + prompts + renderer +
 * picker + eval baselines + slots + merge strategy.
 *
 * Per spec §4.0. Each family ships a FamilyDefinition<FamilyNote> via
 * its own `index.ts` (Plans 3-6).
 */
export interface FamilyDefinition<T extends NoteBase> {
  id: NoteFamily;
  schema: z.ZodType<T>;
  prompts: ReadonlyArray<PromptVariant>;
  defaultPromptVariant: string;
  renderer: ComponentType<{ note: T }>;
  streamingRenderer?: ComponentType<{ partial: Partial<T> }>;
  picker: FamilyPickerConfig;
  evalBaselines: ReadonlyArray<string>;
  inferProvenance?: ProvenanceComputer;
  slots?: ReadonlyArray<SlotDefinition<unknown>>;
  mergeStrategy: MergeStrategy;
}

/**
 * The runtime registry. Empty at Plan 2 landing — Plans 3-6 populate
 * each family. Consumers (orchestrator, picker UI) read this to resolve
 * family-specific behavior.
 *
 * Per spec §4 #8: "Adding a family = mkdir + 1 line in the registry map".
 */
export const familyRegistry: Partial<Record<NoteFamily, FamilyDefinition<NoteBase>>> = {};

/**
 * Type-safe helper to register a family. Plans 3-6 import this in their
 * family `index.ts` and call once at module-load time.
 */
export function registerFamily<T extends NoteBase>(
  def: FamilyDefinition<T>,
): void {
  if (familyRegistry[def.id] !== undefined) {
    throw new Error(`Family ${def.id} already registered`);
  }
  // Cast to NoteBase storage — read-side narrows back via discriminator.
  familyRegistry[def.id] = def as unknown as FamilyDefinition<NoteBase>;
}
