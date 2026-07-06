import { useEffect, useState } from 'react';
import type { ModelStatus } from '@shared/ipc-protocol';
import { ModelDownloadStep } from '../components/ModelDownloadStep';
import { SETUP_STRINGS_JA } from '../i18n/setup-strings';

interface Props {
  /** Fired once both slots are resolved (status.kind === 'ready'). */
  onReady: () => void;
}

type SetupState = { kind: 'download' } | { kind: 'done' };

/** §6.1 — 'done' state auto-redirect delay. Single source of truth so the
 *  timer and any future fade animation can't drift apart. */
const DONE_REDIRECT_MS = 300;

export function SetupView({ onReady }: Props) {
  // Download-first is the unconditional default (in-app model downloader
  // Task 3): every needs-setup case — first-run AND re-launch/partial-missing
  // — starts on the download step. The manual-picker fallback is removed
  // from this flow entirely; ModelDownloadStep's retry covers failure.
  const [state, setState] = useState<SetupState>({ kind: 'download' });

  // §6.1: 'done' state auto-redirects to Recording after DONE_REDIRECT_MS.
  // onReady intentionally excluded from deps — fresh ref each parent render
  // would reset the timer (silent-stall risk if parent re-renders frequently
  // while in 'done'). The () => onReady() wrapper captures the current ref
  // at fire time rather than at scheduling time, which is the desired behavior.
  useEffect(() => {
    if (state.kind !== 'done') return;
    const t = setTimeout(() => onReady(), DONE_REDIRECT_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.kind]);

  if (state.kind === 'done') {
    // NOTE: spec §6.1 mentions a 300ms opacity fade as polish (optional
    // Task 13). The fade is not wired up here — would require a separate
    // useState flipped one tick after mount. Dead `transition` removed
    // so the CSS doesn't claim behavior it doesn't have.
    return (
      <div data-testid="setup-done" className="lz-onb">
        <PencilCheck />
        <h2 className="lz-onb-title">{SETUP_STRINGS_JA.doneTitle}</h2>
        <p className="lz-onb-body">{SETUP_STRINGS_JA.doneBody}</p>
      </div>
    );
  }

  // ModelDownloadStep's resolve is either 'ready' (done) or 'needs-setup'.
  // The manual-picker fallback is gone (Task 3), so 'needs-setup' has
  // nowhere left to route — in practice a resolved download always reports
  // 'ready' or surfaces its own error phase (with retry). Treat a
  // 'needs-setup' resolve as a handler bug: log a breadcrumb and fall
  // through to 'done' rather than stranding the user on a dead screen.
  function handleResolved(status: ModelStatus): void {
    if (status.kind !== 'ready') {
      console.error('[SetupView] download resolved needs-setup — handler bug?', status.missing);
    }
    setState({ kind: 'done' });
  }

  return <ModelDownloadStep onReady={handleResolved} />;
}

/** Hand-drawn done checkmark (Task 4 pencil accent) — grain-filtered stroke,
 *  round caps/joins so it reads as a single pencil gesture rather than a
 *  mechanical icon-font glyph. Purely decorative (aria-hidden); doneTitle
 *  carries the actual "ready" semantics for a11y. */
function PencilCheck() {
  return (
    <svg className="lz-onb-check" viewBox="0 0 40 40" aria-hidden="true">
      <path d="M9 21 L17 29 L31 12" />
    </svg>
  );
}
