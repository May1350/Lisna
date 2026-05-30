import type { Note } from '@shared/types';
import type { NoteBase } from '@shared/note-schema';
import { familyRendererRegistry } from '@shared/families/renderer';

interface Props {
  note: Note | NoteBase;
  onNewSession: () => void;
}

/**
 * Renders the final note view after a session.
 *
 * Two shapes flow through here:
 *
 *   - **Legacy `Note`** (cloud / pre-v2 path): plain markdown emitted by the
 *     curator, rendered as `<pre>` for v2.0 per spec §6.3.
 *   - **Structured `NoteBase`** (v2 on-device finalize): dispatched through
 *     `familyRendererRegistry[note.family]`. The renderer process side-effect-
 *     imports each family's `renderer.tsx` from `main.tsx` so the registry is
 *     populated before this lookup.
 *
 * Discriminator: presence of the `family` field. Legacy `Note` doesn't carry
 * it; every `NoteBase` does.
 */
export function NoteView({ note, onNewSession }: Props) {
  const isStructured = 'family' in note;

  return (
    <section>
      <header style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <h2 style={{ margin: 0 }}>Note</h2>
        <p style={{ color: '#888', margin: 0 }}>
          Generated {new Date(note.generatedAt).toLocaleString()} ·{' '}
          {note.language.toUpperCase()}
          {isStructured && <> · {note.family}</>}
        </p>
        <button onClick={onNewSession} style={{ marginLeft: 'auto' }}>
          New session
        </button>
      </header>

      {isStructured ? <StructuredBody note={note} /> : <LegacyBody note={note} />}
    </section>
  );
}

function StructuredBody({ note }: { note: NoteBase }) {
  const def = familyRendererRegistry[note.family];
  if (!def) {
    // Renderer not registered for this family — fail loud so a wiring miss
    // (forgot the side-effect import in main.tsx) is visible during dev
    // rather than rendering a blank screen.
    return (
      <div data-testid="no-renderer" style={{ color: '#c33' }}>
        No renderer registered for family: {note.family}
      </div>
    );
  }
  const FamilyRenderer = def.renderer;
  return <FamilyRenderer note={note} />;
}

function LegacyBody({ note }: { note: Note }) {
  return (
    <>
      <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'system-ui' }}>{note.markdown}</pre>
      {note.transcriptSegments.length > 0 && (
        <details>
          <summary>Transcript ({note.transcriptSegments.length} segments)</summary>
          <ul style={{ listStyle: 'none', padding: 0, fontFamily: 'monospace' }}>
            {note.transcriptSegments.map((seg, i) => (
              <li key={i}>
                [{seg.startSec.toFixed(1)}] {seg.text}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
