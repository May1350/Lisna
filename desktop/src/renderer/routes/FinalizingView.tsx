import { useEffect, useRef, useState } from 'react';
import type { TranscriptSegment } from '@shared/types';
import { computeMinDisplayDelay, PHASE_MIN_DISPLAY_MS } from '../utils/min-display';
import { Spinner } from '../components/Spinner';

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
 * Hold a phase value on display for at least `minDisplayMs` so labels with
 * short underlying durations (stt-unloading is often <1s) stay on screen
 * long enough to read. Step 5 §3.4.
 *
 * Implementation: when `incomingPhase` changes, schedule the update by the
 * remaining-window ms (0 if the previous display has already lived >= minMs).
 * Pending timeouts are cleared if a newer incoming phase arrives before the
 * scheduled update fires, so we always end on the most recent input.
 */
function useMinDisplayPhase(incomingPhase: Phase, minDisplayMs: number): Phase {
  const [displayed, setDisplayed] = useState<Phase>(incomingPhase);
  const lastChangeAtRef = useRef<number>(Date.now());
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (incomingPhase === displayed) return;
    const delay = computeMinDisplayDelay(lastChangeAtRef.current, Date.now(), minDisplayMs);
    if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
    if (delay === 0) {
      setDisplayed(incomingPhase);
      lastChangeAtRef.current = Date.now();
      return;
    }
    pendingTimerRef.current = setTimeout(() => {
      setDisplayed(incomingPhase);
      lastChangeAtRef.current = Date.now();
      pendingTimerRef.current = null;
    }, delay);
    return () => {
      if (pendingTimerRef.current) {
        clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
    };
  }, [incomingPhase, displayed, minDisplayMs]);

  return displayed;
}

/**
 * Rendered while session/stop is awaiting orch.stop(). The phase prop is driven
 * by session/phase events pushed from main during orchestrator.stop's three
 * internal awaits. The final `llm.unloadModel()` in `finally` is silent — by
 * then the App has already transitioned to NoteView (or ErrorView).
 *
 * 'stt-loading' is NOT in the Phase union here — it fires during session/start,
 * before App transitions to 'finalizing'. Recording.tsx's local `starting`
 * boolean handles that label.
 *
 * Min-display-time: each phase label stays on screen for ≥ PHASE_MIN_DISPLAY_MS
 * (1500ms) — see useMinDisplayPhase above. Without this, the stt-unloading
 * label (which underlying op takes <1s) would flip to llm-loading before the
 * user could read it.
 */
export function FinalizingView({ phase, segments }: Props) {
  const displayedPhase = useMinDisplayPhase(phase, PHASE_MIN_DISPLAY_MS);
  return (
    <section>
      <h2>Generating note</h2>
      <p>
        <Spinner /> {phaseLabel[displayedPhase]}
      </p>
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
