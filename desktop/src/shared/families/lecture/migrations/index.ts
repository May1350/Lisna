import type { Migration } from '@shared/families';

/**
 * Lecture schema-version migrations. Empty for v1 — future schemaVersion 2
 * adds the first entry. `loadNote()` handles the empty case as a no-op
 * (note is already at current version → no migration applied).
 */
export const lectureMigrations: ReadonlyArray<Migration> = [];
