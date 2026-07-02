import type { NoteFamily } from './base';

/**
 * JA display label per note family (note-view header + history list).
 *
 * Kept in its own leaf file with a TYPE-ONLY `NoteFamily` import so importing
 * this map does not pull `base.ts` (and its zod schemas / node:crypto chain)
 * into the renderer bundle. Single source so the UI never shows the raw
 * English enum key in an otherwise-Japanese surface.
 */
export const NOTE_FAMILY_LABEL_JA: Record<NoteFamily, string> = {
  lecture: '講義',
  meeting: '会議',
  interview: 'インタビュー',
  brainstorm: 'ブレスト',
};
