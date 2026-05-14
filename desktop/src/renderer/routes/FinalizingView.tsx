import type { TranscriptSegment } from '@shared/types';

type Phase = 'stt-unloading' | 'llm-loading' | 'generating';

interface Props {
  phase: Phase;
  segments: TranscriptSegment[];
}

const phaseLabel: Record<Phase, string> = {
  'stt-unloading': 'Releasing transcription model…',
  'llm-loading': 'Loading note-writing model…',
  'generating': 'Writing your note…',
};

/**
 * Rendered while session/stop is awaiting orch.stop(). The phase prop is driven
 * by session/phase events pushed from main during orchestrator.stop's three
 * internal awaits. The final `llm.unloadModel()` in `finally` is silent — by
 * then the App has already transitioned to NoteView (or ErrorView).
 *
 * 'stt-loading' is NOT in the Phase union here — it fires during session/start,
 * before App transitions to 'finalizing'. Recording.tsx's local `starting`
 * boolean handles that label.
 */
export function FinalizingView({ phase, segments }: Props) {
  return (
    <section>
      <h2>Generating note</h2>
      <p>{phaseLabel[phase]}</p>
      <p style={{ color: '#888' }}>
        This usually takes 10–30 seconds. Please don't close the app.
      </p>
      {segments.length > 0 && (
        <details>
          <summary>Transcript ({segments.length} segments)</summary>
          <ul style={{ listStyle: 'none', padding: 0, fontFamily: 'monospace' }}>
            {segments.map((seg, i) => (
              <li key={i}>[{seg.startSec.toFixed(1)}] {seg.text}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
