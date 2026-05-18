import type { Note } from '@shared/types';

interface Props {
  note: Note;
  onNewSession: () => void;
}

/**
 * Renders the markdown Note produced by SessionOrchestrator.stop().
 *
 * Markdown is rendered as `<pre>` for v2.0 (no react-markdown dependency).
 * The LLM system prompt is expected to emit plain-text-with-structure
 * (numbered lists, indentation) instead of raw `# Header` / `**bold**` syntax,
 * so `<pre>` rendering looks natural. See spec §6.3 for the v2.1 react-markdown
 * deferral rationale.
 */
export function NoteView({ note, onNewSession }: Props) {
  return (
    <section>
      <h2>Note</h2>
      <p style={{ color: '#888' }}>
        Generated {new Date(note.generatedAt).toLocaleString()} · {note.language.toUpperCase()}
      </p>
      <button onClick={onNewSession}>New session</button>
      <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'system-ui' }}>{note.markdown}</pre>
      {note.transcriptSegments.length > 0 && (
        <details>
          <summary>Transcript ({note.transcriptSegments.length} segments)</summary>
          <ul style={{ listStyle: 'none', padding: 0, fontFamily: 'monospace' }}>
            {note.transcriptSegments.map((seg, i) => (
              <li key={i}>[{seg.startSec.toFixed(1)}] {seg.text}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
