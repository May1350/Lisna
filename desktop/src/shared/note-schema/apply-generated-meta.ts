import { CURRENT_SCHEMA_VERSION } from './forward-incompat';
import type { NoteBase } from './base';

/**
 * System-owned note metadata. The LLM emits these fields too (they live in
 * NoteBase, so the grammar exposes them), but the model's values are
 * untrustworthy: a 1B model hallucinated an invalid `generatedAt` string that
 * rendered as "Invalid Date", a `schemaVersion` of 2 that tripped the
 * forward-incompat guard, and an `en` language on a `ja` session. The app —
 * not the model — owns provenance + schema metadata.
 */
export interface GeneratedMeta {
  generatedAt: string;
  model: string;
  promptVersion: number;
  language: NoteBase['language'];
  durationSec: number;
}

/**
 * Overwrite the system-owned metadata on a freshly-generated note with
 * authoritative values, discarding whatever the grammar-constrained LLM
 * emitted for these fields. Content fields (title, sections, …) are left
 * untouched. Mutates in place and returns the same object.
 *
 * Call AFTER `family.schema.parse(merged)` and merge, BEFORE returning the
 * note. Applies to every family (lecture / meeting / interview / brainstorm).
 */
export function applyGeneratedMeta<T extends NoteBase>(note: T, meta: GeneratedMeta): T {
  note.schemaVersion = CURRENT_SCHEMA_VERSION;
  note.generatedAt = meta.generatedAt;
  note.generatedBy = { model: meta.model, promptVersion: meta.promptVersion };
  note.language = meta.language;
  note.durationSec = meta.durationSec;
  return note;
}
