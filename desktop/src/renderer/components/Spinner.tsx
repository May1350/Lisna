/**
 * Pure CSS animated spinner. Inline-styled so it works in v2.0's
 * styling-light renderer (no Tailwind / CSS modules in the project yet —
 * see brainstorming Q-X "no styling system for v2.0").
 *
 * Renders an inline span the same height as the surrounding text. The
 * `@keyframes lisna-spin` is injected once at module load via a <style>
 * tag appended to <head>. Idempotent: a second module evaluation (HMR /
 * React Strict Mode) checks for the existing style element first.
 *
 * Step 5 §3.3 — Loading progress affordance. Used inline next to the
 * "Loading model…" label in Recording.tsx.
 */
const SPINNER_STYLE_ID = 'lisna-spinner-style';

function ensureSpinnerKeyframes() {
  if (typeof document === 'undefined') return;  // SSR safety; we're Electron renderer-only but be safe.
  if (document.getElementById(SPINNER_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = SPINNER_STYLE_ID;
  style.textContent = `@keyframes lisna-spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }`;
  document.head.appendChild(style);
}

interface Props {
  /** Diameter in px. Default 14 — matches body text x-height. */
  size?: number;
  /** Border thickness in px. Default 2. */
  thickness?: number;
}

export function Spinner({ size = 14, thickness = 2 }: Props = {}) {
  ensureSpinnerKeyframes();
  const style: React.CSSProperties = {
    display: 'inline-block',
    width: size,
    height: size,
    border: `${thickness}px solid #d1d5db`,
    borderTopColor: '#374151',
    borderRadius: '50%',
    animation: 'lisna-spin 0.8s linear infinite',
    verticalAlign: 'middle',
  };
  return <span aria-label="Loading" role="status" style={style} />;
}
