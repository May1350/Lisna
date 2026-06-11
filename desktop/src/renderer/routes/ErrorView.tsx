import type { TranscriptSegment } from '@shared/types';
import {
  toFriendlyJa,
  ERROR_MESSAGE_MAP_JA,
} from '../i18n/error-message-map';

interface Props {
  message: string;
  segments: TranscriptSegment[];
  /**
   * Re-generate the note from the PRESERVED transcript. Routes to the family
   * picker (App.tsx) so the user can pick a DIFFERENT family on retry — the
   * common case is "interview failed → try lecture on the same recording"
   * (interview needs diarization, which the alpha disables). Main keeps the
   * session (`current`) alive on finalize failure (ipc.ts:354), so this
   * re-invokes finalize against the same accumulated transcript.
   */
  onRetry: () => void;
  /**
   * Abandon this recording and start a new one (discards main-side session).
   * The escape hatch when the transcript itself is not worth re-finalizing.
   */
  onDiscard: () => void;
  /**
   * Step 5 §3.6 — true when supervisor has given up (2 consecutive sidecar
   * crashes). Replaces the action buttons with a Restart Lisna button: with a
   * dead sidecar, re-finalize can't run — it would just hit SIDECAR_GAVE_UP.
   */
  permanent?: boolean;
}

/**
 * Rendered when session/stop rejects (LLM load fail, generate throw, STT
 * unload fail, empty transcript) OR when main pushes session/error (sidecar
 * crash mid-session).
 *
 * Friendly copy is JA-only per ADR §3 (`docs/superpowers/decisions/2026-05-15-
 * step-5-section-9-decisions.md`). Resolution lives in `i18n/error-message-map.ts`:
 * exact code → substring code → fallback. The permanent prop forces the
 * SIDECAR_GAVE_UP copy + swaps the action button to Restart Lisna.
 *
 * v2.0 concept-lock is JA-only — no EN fallback. The header text below is
 * also JA. If a future v2.1 introduces a settings UI for locale, add a
 * second map (`ERROR_MESSAGE_MAP_EN` etc.) and dispatch at toFriendly* level.
 */
export function ErrorView({ message, segments, onRetry, onDiscard, permanent }: Props) {
  // Resolve copy. The permanent flag forces the SIDECAR_GAVE_UP message even
  // if `message` came in as a transient "engine restarted" string from an
  // earlier handleSidecarExit push that arrived before the give-up upgrade.
  // Without this, App.tsx's idempotent error-state merge would keep the
  // earlier copy on screen — defeating the purpose of the flag.
  const friendly = permanent ? ERROR_MESSAGE_MAP_JA.SIDECAR_GAVE_UP : toFriendlyJa(message);
  return (
    <section>
      <h2>エラーが発生しました</h2>
      <p style={{ color: 'crimson' }}>{friendly}</p>
      {segments.length > 0 && (
        <details open>
          <summary>これまでの文字起こし ({segments.length} 個のセグメント)</summary>
          <ul style={{ listStyle: 'none', padding: 0, fontFamily: 'monospace' }}>
            {segments.map((seg, i) => (
              <li key={i}>[{seg.startSec.toFixed(1)}] {seg.text}</li>
            ))}
          </ul>
        </details>
      )}
      {permanent ? (
        <button data-testid="error-restart" onClick={() => void window.lisna.restartApp()}>
          Lisna を再起動
        </button>
      ) : (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
          {/* Primary: the transcript is NOT lost — re-make the note from it. */}
          <button data-testid="error-retry-note" onClick={onRetry}>
            ノートを作り直す
          </button>
          {/* Secondary: give up on this recording, start fresh. */}
          <button data-testid="error-new-recording" onClick={onDiscard}>
            新しい録音
          </button>
          {segments.length > 0 && (
            <small style={{ color: '#666' }}>文字起こしは保持されています</small>
          )}
        </div>
      )}
    </section>
  );
}
