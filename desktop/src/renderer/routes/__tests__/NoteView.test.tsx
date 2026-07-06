/** Static structural tests for NoteView (interaction is live-app-verified,
 *  consistent with History.test.tsx / ErrorView.test.tsx). Covers the
 *  note-creation-time title editing wired via the source dump id. */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NoteView } from '../NoteView';
import type { NoteBase } from '@shared/note-schema';

const NOTE: NoteBase = {
  schemaVersion: 1,
  family: 'lecture',
  title: '講義ノート',
  generatedAt: '2026-07-04T10:00:00.000Z',
  generatedBy: { model: 'llama-3.2-3b-q4-km', promptVersion: 1 },
  language: 'ja',
  durationSec: 60,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sections: [] as any,
} as NoteBase;

describe('NoteView', () => {
  it('renders an editable title (fallback = note title) when a dumpId is present', () => {
    const html = renderToStaticMarkup(
      <NoteView note={NOTE} dumpId="2026-07-04T10-00-00-000Z" onNewSession={() => {}} />,
    );
    expect(html).toContain('editable-title');
    // Fresh note → no user title yet → the note's own title shows as the fallback.
    expect(html).toContain('講義ノート');
  });

  it('omits the editable title when there is no dumpId (legacy/cloud path with no dump)', () => {
    const html = renderToStaticMarkup(
      <NoteView note={NOTE} onNewSession={() => {}} />,
    );
    expect(html).not.toContain('editable-title');
  });
});
