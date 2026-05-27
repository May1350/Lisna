import { familyCoreRegistry } from '@shared/families';
import type { NoteBase, NoteFamily } from './base';
import { ForwardIncompatNoteError } from './forward-incompat';

/** The highest schemaVersion this app build can read. Must stay in sync with
 *  post-decode/pipeline.ts::CURRENT_SCHEMA_VERSION. */
const CURRENT_SCHEMA_VERSION = 1;

/**
 * Load + validate a persisted note JSON. Returns `NoteBase` because the
 * runtime family-registry erases the generic — callers downcast via
 * the `note.family` discriminator.
 *
 * Flow:
 *  1. JSON.parse (throws SyntaxError on malformed input — not wrapped)
 *  2. Forward-incompat check (`schemaVersion > CURRENT` → throws ForwardIncompatNoteError)
 *  3. Family lookup (throws `'UNKNOWN_FAMILY:<value>'` if not registered)
 *  4. Migration chain — walk from note's schemaVersion up to CURRENT_SCHEMA_VERSION
 *  5. Zod parse with the family schema
 *
 * Deviation from plan line 1797-1801: the plan used a `for` loop which
 * has a correctness bug for multi-step chains (loop variable `currentV`
 * was not updated between steps). This implementation uses a `while` loop
 * that tracks `currentV` explicitly, making multi-step chains safe when
 * they land in future plans.
 */
export function loadNote(json: string): NoteBase {
  const parsed = JSON.parse(json) as { schemaVersion?: unknown; family?: unknown };

  if (typeof parsed.schemaVersion !== 'number' || parsed.schemaVersion < 1) {
    throw new Error('INVALID_SCHEMA_VERSION');
  }
  if (parsed.schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new ForwardIncompatNoteError(parsed.schemaVersion, CURRENT_SCHEMA_VERSION);
  }

  if (!parsed.family) {
    throw new Error('MISSING_FAMILY');
  }

  const fam = familyCoreRegistry[parsed.family as NoteFamily];
  if (!fam) {
    throw new Error(`UNKNOWN_FAMILY:${String(parsed.family)}`);
  }

  // Walk the migration chain from the note's schemaVersion to CURRENT.
  // Uses a while-loop (not for-loop) so multi-step chains work correctly
  // when they land in future plans — each iteration advances currentV.
  let migrated: unknown = parsed;
  let currentV: number = parsed.schemaVersion;
  const migrations = fam.migrations ?? [];

  while (currentV < CURRENT_SCHEMA_VERSION) {
    const step = migrations.find(m => m.fromVersion === currentV);
    if (!step) {
      throw new Error(`NO_MIGRATION_FROM:${currentV}`);
    }
    migrated = step.run(migrated);
    if (step.toVersion <= currentV) {
      throw new Error(`MIGRATION_NO_PROGRESS:${currentV}->${step.toVersion}`);
    }
    currentV = step.toVersion;
  }

  return fam.schema.parse(migrated);
}
