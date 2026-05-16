import { useEffect, useState } from 'react';
import type { ModelSlot } from '@shared/ipc-protocol';
import { ModelPickerStep } from '../components/ModelPickerStep';
import { SETUP_STRINGS_JA } from '../i18n/setup-strings';

interface Props {
  /** Slot the user should pick FIRST. On first-run = 'stt'. On re-launch
   *  after a file was deleted = the missing slot (may be 'stt' OR 'llm'). */
  initialStep: ModelSlot;
  /** Error code preset for the initial step (re-launch case). */
  initialError?: string;
  /** Fired once both slots are resolved (status.kind === 'ready'). */
  onReady: () => void;
}

type SetupState =
  | { kind: 'picker'; step: ModelSlot; error?: string }
  | { kind: 'done' };

export function SetupView({ initialStep, initialError, onReady }: Props) {
  const [state, setState] = useState<SetupState>({
    kind: 'picker',
    step: initialStep,
    error: initialError,
  });

  // §6.1: 'done' state auto-redirects to Recording after 300ms fade.
  useEffect(() => {
    if (state.kind !== 'done') return;
    const t = setTimeout(onReady, 300);
    return () => clearTimeout(t);
  }, [state.kind, onReady]);

  if (state.kind === 'done') {
    return (
      <div
        data-testid="setup-done"
        style={{
          maxWidth: 560,
          margin: '0 auto',
          padding: 24,
          fontFamily: 'system-ui',
          textAlign: 'center',
          transition: 'opacity 300ms',
        }}
      >
        <h2>{SETUP_STRINGS_JA.ready}</h2>
      </div>
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
      onSuccess={(status) => {
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
          setState({ kind: 'done' });  // defensive fall-through
          return;
        }
        setState({ kind: 'picker', step: nextSlot });
      }}
    />
  );
}
