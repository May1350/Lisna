import { AUDIO_DISCLOSURE_JA } from '../i18n/disclosure-strings';

/**
 * First-run on-device audio-retention disclosure (STT Phase 2 Group G1, spec
 * §5.7 / §13). Shown ONCE, BEFORE the first recording, gating every path into
 * capture (boot-direct and post-setup) — see App.tsx shouldShowAudioNotice.
 *
 * Pure presentational: the parent owns the once-only state (localStorage
 * `lisna.audioNoticeAck`) and passes `onAck`. FUNCTION-FIRST — this is a DENSE
 * WORK surface (the Mac app), so plain inline styles + tokens only, NO
 * legal-pad / post-it / pencil decoration (per .claude/rules/web-design.md
 * scope boundary). JA-locked copy per v2.0 concept-lock.
 *
 * Semantics: role="dialog" + aria-labelledby on the heading — it interrupts the
 * flow into recording and demands an explicit acknowledgement, which is the
 * dialog pattern (not a passive note).
 */

interface Props {
  /** Fired when the user acknowledges. The parent persists the ack + opens the gate. */
  onAck: () => void;
}

/** ink.900 token (.claude/rules/web-design.md) for body text. */
const INK = '#1a1410';
/** burgundy token — the acknowledge action. */
const BURGUNDY = '#6e1e1e';

export function FirstRunAudioNotice({ onAck }: Props) {
  return (
    <section
      role="dialog"
      aria-labelledby="audio-notice-title"
      style={{ maxWidth: 560, color: INK, lineHeight: 1.7 }}
    >
      <h2 id="audio-notice-title" style={{ fontSize: 20, marginBottom: 16 }}>
        {AUDIO_DISCLOSURE_JA.title}
      </h2>
      <p style={{ marginBottom: 12 }}>{AUDIO_DISCLOSURE_JA.deviceOnly}</p>
      <p style={{ marginBottom: 12 }}>{AUDIO_DISCLOSURE_JA.retained}</p>
      <p style={{ marginBottom: 20 }}>{AUDIO_DISCLOSURE_JA.deleteScope}</p>
      <button
        data-testid="audio-notice-ack"
        onClick={onAck}
        style={{
          padding: '8px 16px',
          fontSize: 14,
          color: '#fefbf5',
          background: BURGUNDY,
          border: 'none',
          borderRadius: 4,
          cursor: 'pointer',
        }}
      >
        {AUDIO_DISCLOSURE_JA.ackButton}
      </button>
    </section>
  );
}
