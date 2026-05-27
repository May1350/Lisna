import { familyCoreRegistry } from '@shared/families';
import type { NoteBase, NoteFamily } from './base';
import { CURRENT_SCHEMA_VERSION, ForwardIncompatNoteError } from './forward-incompat';

/**
 * Load + validate a persisted note JSON. Returns `NoteBase` because the
 * runtime family-registry erases the generic — callers downcast via
 * the `note.family` discriminator.
 *
 * Flow:
 *  1. JSON.parse (throws SyntaxError on malformed input — not wrapped)
 *  2. Shape guard (null/array/primitive → throws INVALID_NOTE_SHAPE)
 *  3. Forward-incompat check (`schemaVersion > CURRENT` → throws ForwardIncompatNoteError)
 *  4. Family lookup (throws `'UNKNOWN_FAMILY:<value>'` if not registered)
 *  5. Migration chain — walk from note's schemaVersion up to CURRENT_SCHEMA_VERSION
 *  6. Zod parse with the family schema
 *
 * Deviation from plan line 1797-1801: the plan used a `for` loop which
 * has a correctness bug for multi-step chains (loop variable `currentV`
 * was not updated between steps). This implementation uses a `while` loop
 * that tracks `currentV` explicitly, making multi-step chains safe when
 * they land in future plans.
 */
export function loadNote(json: string): NoteBase {
  const parsed = JSON.parse(json) as Record<string, unknown> | unknown[] | null;

  // Shape guard: reject null, arrays, and primitives. Must be a plain object.
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('INVALID_NOTE_SHAPE');
  }

  const candidate = parsed as { schemaVersion?: unknown; family?: unknown };

  if (typeof candidate.schemaVersion !== 'number' || candidate.schemaVersion < 1) {
    throw new Error('INVALID_SCHEMA_VERSION');
  }
  if (candidate.schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new ForwardIncompatNoteError(candidate.schemaVersion, CURRENT_SCHEMA_VERSION);
  }

  if (!candidate.family) {
    throw new Error('MISSING_FAMILY');
  }

  const fam = familyCoreRegistry[candidate.family as NoteFamily];
  if (!fam) {
    throw new Error(`UNKNOWN_FAMILY:${String(parsed.family)}`);
  }

  // TODO(plan-3-followup): error-string catalog. As Plans 4-6 add more
  // throw sites (session-finalize.ts already has FAMILY_NOT_IMPLEMENTED:*
  // and UNKNOWN_FAMILY:*), the renderer's string-parsing contract grows
  // without a central source of truth. Promote to a `load-errors.ts`
  // const object + factory functions when the third call site lands.

  // Walk the migration chain from the note's schemaVersion to CURRENT.
  // Uses a while-loop (not for-loop) so multi-step chains work correctly
  // when they land in future plans — each iteration advances currentV.
  let migrated: unknown = candidate;
  let currentV: number = candidate.schemaVersion;
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
