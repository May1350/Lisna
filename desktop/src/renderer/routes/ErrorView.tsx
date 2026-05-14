import type { TranscriptSegment } from '@shared/types';

interface Props {
  message: string;
  segments: TranscriptSegment[];
  onRetry: () => void;
  /**
   * Step 5 §3.6 — true when supervisor has given up (2 consecutive sidecar
   * crashes). Replaces the Try Again button with a Restart Lisna button.
   * Try Again would just hit SIDECAR_GAVE_UP again until process exit.
   */
  permanent?: boolean;
}

/**
 * Rendered when session/stop rejects (LLM load fail, generate throw, STT
 * unload fail, empty transcript) OR when main pushes session/error (sidecar
 * crash mid-session).
 *
 * Shows a friendly fallback for raw error CODE strings + collapsible transcript
 * + "Try again" button. The full friendly-message map is Step 5 §3.2 work
 * (founder-decided JA/EN copy). For v2.0 alpha, this interim mapping prevents
 * showing literal 'EMPTY_TRANSCRIPT' / 'SIDECAR_DOWN' codes to the user.
 *
 * The "Try again" button resets App state to a fresh 'recording' view; if the
 * sidecar gave up permanently (2x consecutive crashes), the next session/start
 * will reject SIDECAR_DOWN — that's a known v2.0 gap (see spec §9 "Permanent
 * give-up recovery"; Step 5 §3.6 adds an in-app "Restart engine" path).
 */
const FRIENDLY: Record<string, string> = {
  EMPTY_TRANSCRIPT: "We didn't hear any speech. Please try recording again.",
  MODELS_NOT_CONFIGURED: 'Recording models are not set up. Please contact support.',
  SIDECAR_DOWN: 'The recording engine is restarting. Please wait a few seconds and try again.',
  UNSUPPORTED_LANGUAGE: 'This language is not yet supported.',
  APP_QUIT: 'The app is closing.',  // Recording.tsx already suppresses this, defensive only.
  SESSION_ACTIVE: 'A recording session is already in progress.',
  NO_ACTIVE_SESSION: 'No active recording session.',
  SESSION_NOT_READY: 'The recording engine is still starting. Please wait.',
  // Step 5 §3.5 operation-timeout codes (interim EN copy; Phase E replaces
  // wholesale with JA per ADR §3).
  STT_TIMEOUT: 'The transcription model is taking too long to respond. Please try again.',
  LLM_LOAD_TIMEOUT: 'The note-writing model took too long to load. Please try again.',
  LLM_UNLOAD_TIMEOUT: 'The note-writing model is taking too long to release. Please try again.',
  GENERATE_TIMEOUT: 'Note generation stalled. Please try again.',
  // Step 5 §3.6 give-up code. When this fires, the ErrorView receives
  // permanent=true and renders a Restart button instead of Try Again.
  SIDECAR_GAVE_UP: 'The recording engine could not recover. Please restart the app.',
};

function toFriendly(rawMessage: string): string {
  // Error.message may be the bare code (`new Error('EMPTY_TRANSCRIPT').message === 'EMPTY_TRANSCRIPT'`)
  // or arbitrary text from downstream (e.g. `sidecar process exited`). Try exact match first,
  // then substring match, then generic fallback.
  if (FRIENDLY[rawMessage]) return FRIENDLY[rawMessage];
  for (const code of Object.keys(FRIENDLY)) {
    if (rawMessage.includes(code)) return FRIENDLY[code]!;
  }
  return 'Something went wrong. Please try again.';
}

export function ErrorView({ message, segments, onRetry, permanent }: Props) {
  // Resolve copy. The permanent flag forces the SIDECAR_GAVE_UP message even
  // if `message` came in as a transient "engine restarted" string from an
  // earlier handleSidecarExit push that arrived before the give-up upgrade.
  // Without this, App.tsx's idempotent error-state merge would keep the
  // earlier copy on screen — defeating the purpose of the flag.
  const friendly = permanent ? FRIENDLY.SIDECAR_GAVE_UP! : toFriendly(message);
  return (
    <section>
      <h2>Something went wrong</h2>
      <p style={{ color: 'crimson' }}>{friendly}</p>
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
      {permanent ? (
        <button onClick={() => void window.lisna.restartApp()}>Restart Lisna</button>
      ) : (
        <button onClick={onRetry}>Try again</button>
      )}
    </section>
  );
}
