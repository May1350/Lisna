import type { Migration } from '@shared/families';

/** Interview schema-version migrations. Empty for v1 — loadNote() handles the empty case as a no-op. */
export const interviewMigrations: ReadonlyArray<Migration> = [];
