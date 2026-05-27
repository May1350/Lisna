import type { ComponentType } from 'react';
import type { NoteBase, NoteFamily } from '@shared/note-schema/base';

/**
 * Renderer-side dispatch map for typed slot extras. Keyed by
 * `SlotSchemaDefinition.type` (the `kind` discriminator on each slot
 * instance). Each entry is a React component that receives the array
 * of slot instances of that kind for one section.
 *
 * Lives in the renderer half so the main process never imports React.
 * Per `docs/superpowers/decisions/2026-05-28-family-definition-renderer-split.md`.
 */
export type SlotRendererMap = Readonly<Record<string, ComponentType<{ items: ReadonlyArray<unknown> }>>>;

/**
 * Renderer half of a family definition — React components for the note
 * body and each typed slot extra. Imported only by the renderer process.
 *
 * Per `docs/superpowers/decisions/2026-05-28-family-definition-renderer-split.md`.
 */
export interface FamilyRendererDefinition<T extends NoteBase> {
  id: NoteFamily;
  renderer: ComponentType<{ note: T }>;
  streamingRenderer?: ComponentType<{ partial: Partial<T> }>;
  slotRenderers?: SlotRendererMap;
}

/**
 * Runtime renderer registry. Populated by each family's `renderer.tsx`
 * (Plans 3-6 Task 11-equivalent — app-design lane work). The renderer
 * process composes a `FamilyCoreDefinition` (from `familyCoreRegistry`)
 * with this entry by matching on `id`.
 */
export const familyRendererRegistry: Partial<Record<NoteFamily, FamilyRendererDefinition<NoteBase>>> = {};

/**
 * Type-safe helper to register a family's renderer half. Plans 3-6's
 * renderer barrels (`families/<family>/renderer.tsx`) call this once at
 * module-load time on the renderer side.
 */
export function registerFamilyRenderer<T extends NoteBase>(
  def: FamilyRendererDefinition<T>,
): void {
  if (familyRendererRegistry[def.id] !== undefined) {
    throw new Error(`Family renderer ${def.id} already registered`);
  }
  familyRendererRegistry[def.id] = def as unknown as FamilyRendererDefinition<NoteBase>;
}
