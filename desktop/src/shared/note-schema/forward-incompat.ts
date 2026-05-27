/** The current schema version this app supports. Bump when introducing
 *  a breaking change to any family schema. `loadNote` runs migrations
 *  to bring older notes up to this version; notes with a higher
 *  schemaVersion throw `ForwardIncompatNoteError`.
 */
export const CURRENT_SCHEMA_VERSION = 1;

/**
 * Thrown when a persisted note has a schemaVersion newer than this app
 * build supports. The user needs to update Lisna before opening the note.
 *
 * Shared between `post-decode/pipeline.ts` (per-chunk decode path) and
 * `note-schema/load-note.ts` (render-time load path) so both call sites
 * share one class identity — `instanceof ForwardIncompatNoteError` works
 * regardless of which path threw.
 */
export class ForwardIncompatNoteError extends Error {
  constructor(
    public readonly observed: number,
    public readonly supported: number,
  ) {
    super(
      `Note schemaVersion ${observed} is newer than this app supports (${supported}). Please update Lisna.`,
    );
    this.name = 'ForwardIncompatNoteError';
  }
}
