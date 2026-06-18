/**
 * Recording-screen audio level meter (STT Phase 2 E). Pure presentational —
 * renders an RMS dBFS level (fed live from the audio orchestrator's onLevel)
 * as a horizontal bar. FUNCTION-FIRST: this is a DENSE WORK surface (the Mac
 * app), so it uses plain inline styles + tokens only — NO legal-pad / post-it /
 * pencil decoration (per .claude/rules/web-design.md scope boundary).
 *
 * Semantics: role="meter" (NOT aria-live — a meter updating many times/sec
 * would flood a screen reader; role="meter" is the correct, quiet semantic).
 */

/** dBFS at or above which we flag clipping (≈ full scale). */
export const CLIP_DBFS = -1;

interface Props {
  /** RMS level in dBFS, expected in [-60, 0] (the orchestrator clamps it). */
  dbfs: number;
  /** Optional source label, surfaced in the aria-label (e.g. "Microphone"). */
  deviceName?: string;
}

const FLOOR_DBFS = -60;

/** sage accent (.claude/rules/web-design.md token) for a normal level. */
const FILL_OK = '#5fa872';
/** print.red token — fill turns red on clip. */
const FILL_CLIP = '#c8333a';

export function LevelMeter({ dbfs, deviceName }: Props) {
  const clipping = dbfs >= CLIP_DBFS;
  const pct = Math.max(
    0,
    Math.min(100, ((dbfs - FLOOR_DBFS) / (0 - FLOOR_DBFS)) * 100),
  );
  const label = deviceName ? `音声レベル — ${deviceName}` : '音声レベル';

  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={FLOOR_DBFS}
      aria-valuemax={0}
      aria-valuenow={Math.round(dbfs)}
      style={{ display: 'flex', alignItems: 'center', gap: '0.5em', marginTop: '0.4em' }}
    >
      <div
        style={{
          flex: 1,
          height: '0.5em',
          background: 'rgba(60,45,15,0.12)',
          borderRadius: '0.25em',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: clipping ? FILL_CLIP : FILL_OK,
            transition: 'width 80ms linear',
          }}
        />
      </div>
      {clipping && (
        <span
          data-testid="level-clip"
          style={{ color: FILL_CLIP, fontSize: '0.7em', fontWeight: 700, letterSpacing: '0.05em' }}
        >
          CLIP
        </span>
      )}
    </div>
  );
}
