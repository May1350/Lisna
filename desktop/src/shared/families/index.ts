import type { z } from 'zod';
import type { NoteBase, NoteFamily } from '@shared/note-schema/base';
import type { ProvenanceComputer } from '@shared/note-schema/provenance';
import type { PromptVariant } from './util/prompts';
import type { SlotSchemaDefinition } from './util/slot';

// Re-exports per Plan 2 final reviewer carry-forward #1 — downstream
// plans import these symbols by name from `@shared/families` rather than
// 3-path imports into `util/`.
export type { PromptVariant } from './util/prompts';
export { selectPromptVariant } from './util/prompts';
export type { SlotSchemaDefinition } from './util/slot';

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

/** Picker config — i18n keys, icon path, visibility. Per spec §4 #8.
 *
 * `iconPath` is a string (asset path or icon-set key), NOT a React
 * ComponentType — `FamilyCoreDefinition` must be React-free so the main
 * process can read the registry without pulling renderer code. The
 * renderer resolves the icon at render time. Per
 * `docs/superpowers/decisions/2026-05-28-family-definition-renderer-split.md`.
 */
export interface FamilyPickerConfig {
  labelKey: string;
  iconPath: string;
  descriptionKey: string;
  visibility: 'production' | 'experimental';
}

/**
 * Core half of a family definition — schema, prompts, slot schemas,
 * merge strategy, picker config, eval baselines. React-free, safe to
 * import from main + renderer.
 *
 * Per spec §4.0 and
 * `docs/superpowers/decisions/2026-05-28-family-definition-renderer-split.md`.
 * Each family ships a `FamilyCoreDefinition<FamilyNote>` via its own
 * `core.ts` (Plans 3-6).
 *
 * The renderer half (React components for the note + each slot) lives
 * in `FamilyRendererDefinition` in `families/renderer.tsx`, imported
 * only by the renderer process.
 */
export interface FamilyCoreDefinition<T extends NoteBase> {
  id: NoteFamily;
  schema: z.ZodType<T>;
  prompts: ReadonlyArray<PromptVariant>;
  defaultPromptVariant: string;
  picker: FamilyPickerConfig;
  evalBaselines: ReadonlyArray<string>;
  inferProvenance?: ProvenanceComputer;
  slots?: ReadonlyArray<SlotSchemaDefinition<unknown>>;
  mergeStrategy: MergeStrategy;
}

/**
 * The runtime core registry. Empty at Plan 2 landing — Plans 3-6
 * populate each family. Main + renderer both read this. Renderer
 * additionally reads `familyRendererRegistry` for JSX components.
 *
 * Per spec §4 #8: "Adding a family = mkdir + 1 line in the registry map".
 */
export const familyCoreRegistry: Partial<Record<NoteFamily, FamilyCoreDefinition<NoteBase>>> = {};

/**
 * Type-safe helper to register a family's core. Plans 3-6 import this
 * in their family `core.ts` and call once at module-load time. The
 * renderer half is registered separately via `registerFamilyRenderer`
 * from `families/renderer.tsx`.
 */
export function registerFamilyCore<T extends NoteBase>(
  def: FamilyCoreDefinition<T>,
): void {
  if (familyCoreRegistry[def.id] !== undefined) {
    throw new Error(`Family core ${def.id} already registered`);
  }
  // Cast to NoteBase storage — read-side narrows back via discriminator.
  familyCoreRegistry[def.id] = def as unknown as FamilyCoreDefinition<NoteBase>;
}
