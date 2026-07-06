import { useEffect, useState } from 'react';
import type { ModelSlot, ModelStatus } from '@shared/ipc-protocol';
import { ModelDownloadStep } from '../components/ModelDownloadStep';
import { ModelPickerStep } from '../components/ModelPickerStep';
import { SETUP_STRINGS_JA } from '../i18n/setup-strings';

interface Props {
  /** Slot the user should pick FIRST if they opt into the picker fallback.
   *  On first-run = 'stt'. On re-launch after a file was deleted = the
   *  missing slot (may be 'stt' OR 'llm'). */
  initialStep: ModelSlot;
  /** Error code preset for the picker's initial step (re-launch case). Only
   *  surfaced if the user opts into the manual picker via the `use-picker`
   *  fallback link — NOT auto-routed to on mount. Download-first is the
   *  unconditional default for every needs-setup case. */
  initialError?: string;
  /** Fired once both slots are resolved (status.kind === 'ready'). */
  onReady: () => void;
}

type SetupState =
  | { kind: 'download' }
  | { kind: 'picker'; step: ModelSlot; error?: string }
  | { kind: 'done' };

/** §6.1 — 'done' state auto-redirect delay. Single source of truth so the
 *  timer and any future fade animation can't drift apart. */
const DONE_REDIRECT_MS = 300;

export function SetupView({ initialStep, initialError, onReady }: Props) {
  // Download-first is the unconditional default (in-app model downloader
  // Task 3): every needs-setup case — first-run AND re-launch/partial-missing
  // — starts on the download step. Users who already have the files opt into
  // the manual ModelPickerStep via the `use-picker` fallback link, at which
  // point `initialError` (if any) is surfaced there.
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
      <div
        data-testid="setup-done"
        style={{
          maxWidth: 560,
          margin: '0 auto',
          padding: 24,
          fontFamily: 'system-ui',
          textAlign: 'center',
        }}
      >
        <h2>{SETUP_STRINGS_JA.ready}</h2>
      </div>
    );
  }

  // Shared by both ModelDownloadStep and ModelPickerStep onSuccess/onReady —
  // a resolved ModelStatus is either 'ready' (done) or 'needs-setup' (route
  // to the picker for the next missing slot).
  function handleResolved(status: ModelStatus): void {
    if (status.kind === 'ready') {
      setState({ kind: 'done' });
      return;
    }
    // needs-setup — pick the next missing slot. Sort guarantees 'stt'
    // comes before 'llm' so [0] is the right pick. The undefined check
    // satisfies noUncheckedIndexedAccess; logically unreachable since
    // needs-setup always has ≥1 missing slot (otherwise it'd be ready).
    const nextSlot = status.missing[0];
    if (!nextSlot) {
      // Handler bug — surface a breadcrumb so the founder can grep
      // logs. Falling through to 'done' would otherwise manifest as
      // an opaque Recording-side failure when models aren't actually
      // resolved.
      console.error('[SetupView] needs-setup with missing.length=0 — handler bug?');
      setState({ kind: 'done' });
      return;
    }
    setState({ kind: 'picker', step: nextSlot });
  }

  if (state.kind === 'download') {
    return (
      <ModelDownloadStep
        onReady={handleResolved}
        // Opt into the manual picker — surface `initialError` here (and only
        // here), never by auto-routing on mount.
        onUsePicker={() => setState({ kind: 'picker', step: initialStep, error: initialError })}
      />
    );
  }

  // §6.1: step indicator depends on which slot is currently being picked.
  // We always show 2 total. The "current" displayed number is 1 for STT,
  // 2 for LLM — regardless of whether the user landed here on first-run
  // or on re-launch missing the LLM only (in which case Step 1 is skipped
  // visually but still "Step 2" in the indicator — keeps the UI consistent
  // with the total). NOTE: on re-launch missing STT only, "Step 1 / 2"
  // makes sense because LLM is already validated.
  const indicator: { current: 1 | 2; total: 2 } =
    state.step === 'stt' ? { current: 1, total: 2 } : { current: 2, total: 2 };

  return (
    <ModelPickerStep
      key={state.step}
      slot={state.step}
      stepIndicator={indicator}
      initialError={state.error}
      onSuccess={handleResolved}
    />
  );
}
