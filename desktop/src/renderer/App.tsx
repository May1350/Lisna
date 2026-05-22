import { useEffect, useState } from 'react';
import { Recording } from './routes/Recording';
import { NoteView } from './routes/NoteView';
import { ErrorView } from './routes/ErrorView';
import { FinalizingView } from './routes/FinalizingView';
import { SetupView } from './routes/SetupView';
import { SignInView } from './routes/SignInView';
import type { Note, TranscriptSegment } from '@shared/types';
import type { SessionPhase } from '@shared/ipc-protocol';

type FinalizingPhase = Exclude<SessionPhase, 'stt-loading'>;

type View =
  | { kind: 'booting' }
  | { kind: 'setup'; initialStep: 'stt' | 'llm'; initialError?: string }
  | { kind: 'recording'; segments: TranscriptSegment[] }
  | { kind: 'finalizing'; phase: FinalizingPhase; segments: TranscriptSegment[] }
  | { kind: 'note'; note: Note }
  | { kind: 'error'; message: string; segments: TranscriptSegment[]; permanent?: boolean };

/**
 * Phase M Task 70 — top-level auth gate.
 *
 * Boot order:
 *   1. Render nothing while `signedIn === null` (waiting for getAuthState).
 *   2. If `signedIn === false`, show SignInView (button → main opens browser).
 *   3. If `signedIn === true`, hand off to AuthenticatedApp.
 *
 * Two parallel mechanisms keep the gate in sync with main-side auth state:
 *   - `getAuthState()` poll on mount handles the cold-start race where
 *     `handleAuthCallback` ran during boot (argv `lisna://callback?code=…`)
 *     BEFORE the renderer subscribed. The flushPendingUrl in main/index.ts
 *     fires after createWindow but before React mounts; by the time the
 *     poll's promise resolves, the token is already in Keychain.
 *   - `onSignedIn` subscription handles warm dispatch: user clicks Sign In,
 *     browser flow completes, open-url delivers the deep link, the renderer
 *     is already mounted and listening.
 *
 * Race precedence (M-IM1):
 *   The latched-true state wins all races. The poll resolution can only
 *   advance state from `null` (initial) to its read value; it never demotes
 *   an already-`true` value back to `false`. This matters when the cold-start
 *   `auth/signed-in` event arrives BEFORE the `getAuthState` IPC reply (the
 *   reply was already in-flight reading a stale pre-storeToken Keychain
 *   state). Without the functional-update precedence, the late poll could
 *   overwrite the event's `true` with the stale `false`. With it:
 *     - poll-first-true   → null→true; event redundantly sets true→true ✓
 *     - poll-first-false  → null→false; event later may set false→true ✓
 *     - event-first-true  → null→true; poll's prev===true branch keeps true ✓
 *     - event-late-true   → null→false (stale poll), then false→true (event) ✓
 *   Once true, the gate is permanently latched; sign-out (future) must reset
 *   state through a separate mechanism, not via this poll.
 */
export function App() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    window.lisna.getAuthState().then((s) => {
      // M-IM1: never demote latched-true. If the event won the cold-start
      // race and already flipped signedIn to true, the poll's stale `false`
      // (Keychain read pre-storeToken) must not overwrite it.
      if (active) setSignedIn((prev) => (prev === true ? true : s.signedIn));
    });
    const off = window.lisna.onSignedIn(() => {
      if (active) setSignedIn(true);
    });
    return () => {
      active = false;
      off();
    };
  }, []);

  if (signedIn === null) return null;
  if (!signedIn) return <SignInView />;
  return <AuthenticatedApp />;
}

/**
 * Post-auth shell — owns the v2 alpha session FSM (`booting | setup |
 * recording | finalizing | note | error`) and the three onChunk / onPhase /
 * onSessionError subscriptions. Extracted from the pre-Task-70 `App()` body
 * verbatim; only the wrapper changed.
 *
 * Why a function component instead of inlining into the gate: keeps the
 * existing 4-useEffect boot sequence (model status, chunk, phase, session
 * error) gated behind successful auth — the chunk/phase listeners and the
 * getModelStatus call have no reason to fire on the SignInView and would
 * be wasted work / log noise pre-sign-in. The function-component split
 * also means React unmounts AuthenticatedApp on sign-out (future feature),
 * automatically tearing down its listeners.
 */
function AuthenticatedApp() {
  const [view, setView] = useState<View>({ kind: 'booting' });

  // Chunk-result: accept in 'recording' AND 'finalizing'. The renderer-side
  // RecordingOrchestrator.stop()'s synchronous acc.flush() ships the final
  // partial chunk after the user clicks Stop. Its transcribe completes on
  // main side ~50-500ms later — by then App is in 'finalizing'. Dropping that
  // chunk-result would lose the last spoken sentence from FinalizingView's
  // transcript display and from the final Note.transcriptSegments.
  useEffect(() => {
    return window.lisna.onChunk((msg) => {
      setView((prev) => {
        if (prev.kind === 'recording' || prev.kind === 'finalizing') {
          return { ...prev, segments: [...prev.segments, ...msg.segments] };
        }
        return prev;
      });
    });
  }, []);

  // Phase events: only act during 'finalizing'. The 'stt-loading' phase
  // emitted during session/start is ignored here — Recording's local
  // `starting` boolean drives the Start-button label.
  useEffect(() => {
    return window.lisna.onPhase(({ phase }) => {
      if (phase === 'stt-loading') return;
      // Explicit local binding so TS narrows `phase` past the 'stt-loading' exit
      // when assigning into View['finalizing'].phase (the 3-value subset).
      const finalizingPhase: FinalizingPhase = phase;
      setView((prev) => (prev.kind === 'finalizing' ? { ...prev, phase: finalizingPhase } : prev));
    });
  }, []);

  // Session error (sidecar crash). Idempotent merge:
  //   - First push: transition to 'error' view, preserving transcript segments.
  //   - Second push with permanent=true (give-up upgrade arriving after the
  //     transient handleSidecarExit push): keep the existing message/segments
  //     but flip the permanent flag so ErrorView swaps to the Restart button.
  //   - Repeat transient pushes: ignored (keep first message).
  // This handles the supervisor's onExit-then-onCrash sequence: ipc.ts pushes
  // the transient message first, then handleSidecarGiveUp pushes the
  // permanent upgrade — both via the same channel.
  useEffect(() => {
    return window.lisna.onSessionError(({ message, permanent }) => {
      setView((prev) => {
        if (prev.kind === 'error') {
          // Already in error — only upgrade flag, don't overwrite message/segments.
          return permanent && !prev.permanent ? { ...prev, permanent: true } : prev;
        }
        const segments =
          prev.kind === 'recording' || prev.kind === 'finalizing' ? prev.segments : [];
        return { kind: 'error', message, segments, permanent };
      });
    });
  }, []);

  // §5.1 — on mount, query main for the boot-resolved ModelStatus.
  // Safe to call here without race: main/index.ts registers models/status
  // BEFORE createWindow (Task 7), so the handler is always present by the
  // time this mounts. While in 'booting', the existing onChunk/onPhase/
  // onSessionError listeners are naturally inert (their prev.kind guards
  // no-op).
  useEffect(() => {
    window.lisna
      .getModelStatus()
      .then((status) => {
        if (status.kind === 'ready') {
          setView({ kind: 'recording', segments: [] });
          return;
        }
        // status.missing is sorted: 'stt' before 'llm'. First missing slot
        // is where the picker starts. If we're re-prompting because a
        // previously-set path is now missing, surface that as initialError.
        const initialStep = status.missing[0];
        if (!initialStep) {
          // Unreachable: needs-setup always has ≥1 missing slot. Guard for
          // noUncheckedIndexedAccess strictness. Log a breadcrumb so a
          // handler bug surfaces in CloudWatch / DevTools instead of
          // silently manifesting as a Recording-side failure.
          console.error('[App] needs-setup with missing.length=0 — model-resolver bug?');
          setView({ kind: 'recording', segments: [] });
          return;
        }
        const initialError =
          initialStep === 'stt' ? 'MODEL_FILE_MISSING_STT' : 'MODEL_FILE_MISSING_LLM';
        // First-run case: missing.length === 2; treat as no error (clean state).
        const error = status.missing.length === 2 ? undefined : initialError;
        setView({ kind: 'setup', initialStep, initialError: error });
      })
      .catch((err) => {
        // The main-side getModelStatus handler returns cached state — no
        // failure path of its own. But IPC infrastructure CAN reject (main
        // crash mid-boot, contextBridge serialization failure, etc.). Silent
        // hang on the blank 'booting' screen is the worst-UX failure mode
        // for first-launch; surface to a permanent error view so the user
        // sees "Lisna を再起動してください" instead of a white window.
        console.error('[App] getModelStatus rejected during boot', err);
        setView({
          kind: 'error',
          message: 'MODELS_NOT_CONFIGURED',
          segments: [],
          permanent: true,
        });
      });
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui', padding: 24 }}>
      <h1>Lisna v2 — on-device</h1>
      {renderView(view, setView)}
    </main>
  );
}

function renderView(view: View, setView: (next: View | ((p: View) => View)) => void) {
  switch (view.kind) {
    case 'booting':
      return <div data-testid="booting" />;  // null UI; resolved in ~ms
    case 'setup':
      return (
        <SetupView
          initialStep={view.initialStep}
          initialError={view.initialError}
          onReady={() => setView({ kind: 'recording', segments: [] })}
        />
      );
    case 'recording':
      return (
        <Recording
          segments={view.segments}
          onFinalizing={() =>
            setView((prev) =>
              prev.kind === 'recording'
                ? { kind: 'finalizing', phase: 'stt-unloading', segments: prev.segments }
                : prev,
            )
          }
          onNote={(note) => setView({ kind: 'note', note })}
          onError={(message) =>
            setView((prev) => {
              if (prev.kind === 'error') return prev;
              const segments =
                prev.kind === 'recording' || prev.kind === 'finalizing' ? prev.segments : [];
              // Synchronous SIDECAR_GAVE_UP rejection (e.g. user clicked Start
              // after give-up, before any onSessionError push reached the
              // renderer): infer permanent here so the restart UX kicks in
              // without waiting for the IPC channel.
              const permanent = message.includes('SIDECAR_GAVE_UP') || undefined;
              return { kind: 'error', message, segments, permanent };
            })
          }
        />
      );
    case 'finalizing':
      return <FinalizingView phase={view.phase} segments={view.segments} />;
    case 'note':
      return (
        <NoteView
          note={view.note}
          onNewSession={() => setView({ kind: 'recording', segments: [] })}
        />
      );
    case 'error':
      return (
        <ErrorView
          message={view.message}
          segments={view.segments}
          permanent={view.permanent}
          onRetry={() => setView({ kind: 'recording', segments: [] })}
        />
      );
  }
}
