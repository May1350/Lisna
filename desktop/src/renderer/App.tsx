import { useEffect, useState } from 'react';
import { Recording } from './routes/Recording';
import { History } from './routes/History';
import { NoteView } from './routes/NoteView';
import { ErrorView } from './routes/ErrorView';
import { SetupView } from './routes/SetupView';
import { SignInView } from './routes/SignInView';
import { FamilyPickerStep } from './components/FamilyPickerStep';
import { NoteRenderProgress, type ProgressState } from './components/NoteRenderProgress';
import type { Note, TranscriptSegment } from '@shared/types';
import type { NoteBase, NoteFamily } from '@shared/note-schema';

export type ErrorOrigin = { kind: 'live' } | { kind: 'dump'; id: string };

type View =
  | { kind: 'booting' }
  | { kind: 'setup'; initialStep: 'stt' | 'llm'; initialError?: string }
  | { kind: 'recording'; segments: TranscriptSegment[] }
  | { kind: 'history'; id: string }
  | { kind: 'familyPicking'; segments: TranscriptSegment[] }
  | { kind: 'curatingV2'; segments: TranscriptSegment[]; progress: ProgressState | null }
  | { kind: 'note'; note: Note | NoteBase }
  | { kind: 'error'; message: string; segments: TranscriptSegment[]; permanent?: boolean; origin?: ErrorOrigin };

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
 * Post-auth shell — owns the v2 session FSM (`booting | setup | recording |
 * familyPicking | curatingV2 | note | error`) and the onChunk +
 * onSessionError subscriptions. The v2 finalize flow runs at the App level:
 * Stop → familyPicking → curatingV2 (window.lisna.finalize) → note (NoteView
 * dispatches via familyRendererRegistry).
 *
 * Why a function component instead of inlining into the gate: keeps the
 * boot sequence (model status, chunk, session error) gated behind
 * successful auth — the listeners and getModelStatus call have no reason to
 * fire on the SignInView and would be wasted work / log noise pre-sign-in.
 * The function-component split also means React unmounts AuthenticatedApp
 * on sign-out (future feature), automatically tearing down its listeners.
 */
function AuthenticatedApp() {
  const [view, setView] = useState<View>({ kind: 'booting' });

  // Chunk-result: accept in any in-flight session view. RecordingOrchestrator.
  // stop()'s synchronous acc.flush() ships the final partial chunk after the
  // user clicks Stop; its transcribe completes on main side ~50-500ms later.
  // By then App may already be in 'familyPicking' or 'curatingV2'. Accepting
  // chunk-results across that whole window keeps the last spoken sentence in
  // the transcript that feeds finalize.
  useEffect(() => {
    return window.lisna.onChunk((msg) => {
      setView((prev) => {
        if (
          prev.kind === 'recording' ||
          prev.kind === 'familyPicking' ||
          prev.kind === 'curatingV2'
        ) {
          return { ...prev, segments: [...prev.segments, ...msg.segments] };
        }
        return prev;
      });
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
        const segments = inFlightSegments(prev);
        return { kind: 'error', message, segments, permanent };
      });
    });
  }, []);

  // §5.1 — on mount, query main for the boot-resolved ModelStatus.
  // Safe to call here without race: main/index.ts registers models/status
  // BEFORE createWindow (Task 7), so the handler is always present by the
  // time this mounts. While in 'booting', the existing onChunk /
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
          onStop={() =>
            setView((prev) => {
              if (prev.kind !== 'recording') return prev;
              // Empty recording (e.g. silent system-audio capture): nothing to
              // make a note FROM — skip the picker, drop main-side session
              // state, stay on Recording for an immediate retry.
              if (prev.segments.length === 0) {
                void window.lisna.discardSession();
                return { kind: 'recording', segments: [] };
              }
              return { kind: 'familyPicking', segments: prev.segments };
            })
          }
          onError={(message) =>
            setView((prev) => {
              if (prev.kind === 'error') return prev;
              const segments = inFlightSegments(prev);
              // Synchronous SIDECAR_GAVE_UP rejection (e.g. user clicked Start
              // after give-up, before any onSessionError push reached the
              // renderer): infer permanent here so the restart UX kicks in
              // without waiting for the IPC channel.
              const permanent = message.includes('SIDECAR_GAVE_UP') || undefined;
              return { kind: 'error', message, segments, permanent };
            })
          }
          onOpenHistory={(id) => setView({ kind: 'history', id })}
        />
      );
    case 'history':
      return (
        <History
          id={view.id}
          onBack={() => setView({ kind: 'recording', segments: [] })}
          onRegenerate={(family, segments) => {
            // Mirror the live picker flow: mount progress synchronously,
            // then run the from-dump finalize.
            setView({ kind: 'curatingV2', segments: [...segments], progress: { phase: 'loading' } });
            void runFinalizeFromDump(view.id, family, setView);
          }}
        />
      );
    case 'familyPicking':
      return (
        <FamilyPickerStep
          onDiscard={() => {
            // Drop the session in main (clears SESSION_ACTIVE) and return to
            // Recording. Fire-and-forget: the handler is idempotent and the
            // UI transition must not block on IPC latency.
            void window.lisna.discardSession();
            setView({ kind: 'recording', segments: [] });
          }}
          onPick={(family) => {
            // Transition to curating BEFORE await so progress UI mounts
            // synchronously while finalize runs (≈30 s LLM load + per-chunk
            // generate loop).
            setView((prev) =>
              prev.kind === 'familyPicking'
                ? { kind: 'curatingV2', segments: prev.segments, progress: { phase: 'loading' } }
                : prev,
            );
            void runFinalize(family, setView);
          }}
        />
      );
    case 'curatingV2':
      return <NoteRenderProgress progress={view.progress} />;
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
          // Re-make the note from the PRESERVED transcript: route to the family
          // picker so the user can switch family on retry (e.g. interview →
          // lecture). Main keeps `current` alive on finalize failure
          // (ipc.ts:354), so FamilyPicker → finalize re-runs against the same
          // accumulated transcript — no re-recording, no lost captions.
          // Review P0-3: from-dump errors route back to History (no live
          // session exists to retry against); live/legacy errors keep F1 edge.
          onRetry={() => setView(retryViewFor(view))}
          // Abandon this recording: drop main-side session, start fresh.
          onDiscard={() => {
            void window.lisna.discardSession();
            setView({ kind: 'recording', segments: [] });
          }}
        />
      );
  }
}

/**
 * Review P0-3: ErrorView's retry edge is origin-aware. Live-origin (or
 * legacy origin-less) failures keep the F1 edge — familyPicking against the
 * preserved live transcript (`current` survives failure, ipc.ts P0-3). A
 * from-dump failure has NO live session, so retry routes back to the History
 * detail where the family is re-pickable and regenerate re-dispatches
 * finalizeFromDump.
 */
export function retryViewFor(error: {
  origin?: ErrorOrigin;
  segments: TranscriptSegment[];
}): View {
  return error.origin?.kind === 'dump'
    ? { kind: 'history', id: error.origin.id }
    : { kind: 'familyPicking', segments: error.segments };
}

/**
 * Return any transcript segments captured during the current in-flight
 * session phase. Used to preserve captions when transitioning into the
 * error view. Returns [] for non-in-flight states.
 */
function inFlightSegments(view: View): TranscriptSegment[] {
  switch (view.kind) {
    case 'recording':
    case 'familyPicking':
    case 'curatingV2':
      return view.segments;
    default:
      return [];
  }
}

/**
 * Runs the v2 finalize IPC and dispatches the FSM accordingly. Lives at
 * module scope so renderView can call it without re-creating per render.
 *
 * On success: transition to `{ kind: 'note', note }` — NoteView dispatches
 * to the registered family renderer via familyRendererRegistry.
 * On error: transition to `{ kind: 'error', ... }`. APP_QUIT suppressed.
 */
async function runFinalize(
  family: NoteFamily,
  setView: (next: View | ((p: View) => View)) => void,
): Promise<void> {
  try {
    const result = await window.lisna.finalize({ family });
    setView({ kind: 'note', note: result.note });
  } catch (err) {
    const message = String((err as Error)?.message ?? err);
    if (message.includes('APP_QUIT')) return;
    setView((prev) => {
      if (prev.kind === 'error') return prev;
      const segments = inFlightSegments(prev);
      const permanent = message.includes('SIDECAR_GAVE_UP') || undefined;
      return { kind: 'error', message, segments, permanent };
    });
  }
}

/**
 * From-dump twin of runFinalize. Failure carries `origin: {kind:'dump', id}`
 * so the ErrorView retry edge routes back to History (review P0-3) instead
 * of the live finalize (which would deterministically NO_ACTIVE_SESSION).
 */
async function runFinalizeFromDump(
  id: string,
  family: NoteFamily,
  setView: (next: View | ((p: View) => View)) => void,
): Promise<void> {
  try {
    const result = await window.lisna.finalizeFromDump({ id, family });
    setView({ kind: 'note', note: result.note });
  } catch (err) {
    const message = String((err as Error)?.message ?? err);
    if (message.includes('APP_QUIT')) return;
    setView((prev) => {
      if (prev.kind === 'error') return prev;
      return {
        kind: 'error',
        message,
        segments: inFlightSegments(prev),
        origin: { kind: 'dump', id },
      };
    });
  }
}
