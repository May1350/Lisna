import type { TranscriptSegment } from '@shared/types';

interface Props {
  message: string;
  segments: TranscriptSegment[];
  onRetry: () => void;
}

/**
 * Rendered when session/stop rejects (LLM load fail, generate throw, STT
 * unload fail) OR when main pushes session/error (sidecar crash mid-session).
 *
 * Shows the raw error message + collapsible transcript fallback so the user
 * isn't left empty-handed. The "Try again" button resets App state to a fresh
 * 'recording' view; if the sidecar gave up permanently (2x consecutive crashes),
 * the next session/start will reject SIDECAR_DOWN — that's a known v2.0 gap
 * (see spec §9 "Permanent give-up recovery").
 */
export function ErrorView({ message, segments, onRetry }: Props) {
  return (
    <section>
      <h2>Something went wrong</h2>
      <p style={{ color: 'crimson' }}>{message}</p>
      <p style={{ color: '#888' }}>
        Try again — wait a few seconds if the engine is restarting.
      </p>
      {segments.length > 0 && (
        <details open>
          <summary>Transcript so far ({segments.length} segments)</summary>
          <ul style={{ listStyle: 'none', padding: 0, fontFamily: 'monospace' }}>
            {segments.map((seg, i) => (
              <li key={i}>[{seg.startSec.toFixed(1)}] {seg.text}</li>
            ))}
          </ul>
        </details>
      )}
      <button onClick={onRetry}>Try again</button>
    </section>
  );
}
