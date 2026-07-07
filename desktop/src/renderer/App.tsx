import { useEffect, useState, type CSSProperties } from 'react';
import { Recording } from './routes/Recording';
import { History } from './routes/History';
import { NoteView } from './routes/NoteView';
import { ErrorView } from './routes/ErrorView';
import { SetupView } from './routes/SetupView';
import { SignInView } from './routes/SignInView';
import { FamilyPickerStep, type GenerationTarget } from './components/FamilyPickerStep';
import { FirstRunAudioNotice } from './components/FirstRunAudioNotice';
import { TranscriptView } from './routes/TranscriptView';
import { TermsView } from './routes/TermsView';
import { ConnectorView } from './routes/ConnectorView';
import { formatElapsed, type ProgressState } from './components/NoteRenderProgress';
import type { Note, TranscriptSegment } from '@shared/types';
import type { FinalizeProgressPayload } from '@shared/ipc-protocol';
import type { NoteBase, NoteFamily } from '@shared/note-schema';
import { toFriendlyJa } from './i18n/error-message-map';

// Record-then-transcribe: empty/too-short detection is by elapsed time (no live segments). The real empty/silent case is caught server-side by EMPTY_RECORDING.
export const MIN_RECORDING_SEC = 1;
export function isEmptyRecording(elapsedSec: number): boolean {
  return elapsedSec < MIN_RECORDING_SEC;
}

export type ErrorOrigin = { kind: 'live' } | { kind: 'dump'; id: string };

/**
 * Group G1 §5.7/§13 — once-only first-run on-device audio-retention disclosure
 * gate. Pure decision (exported for tests; the project's vitest config has no
 * DOM env so the localStorage state + render swap is verified via the live app).
 *
 * The notice gates ALL paths into recording — both the boot-direct
 * `getModelStatus → ready → recording` jump and the post-setup
 * `SetupView.onReady → recording` jump. Gating only the boot effect would miss
 * a brand-new user (setup FIRST, then their first record). So the gate keys
 * ONLY on (a) not-yet-acknowledged and (b) the view being `recording`: until
 * acknowledged, FirstRunAudioNotice shows and <Recording> is NOT mounted
 * (capture cannot begin); after acknowledging, the gate opens and Recording
 * mounts.
 */
export function shouldShowAudioNotice(audioNoticeAck: boolean, viewKind: View['kind']): boolean {
  return !audioNoticeAck && viewKind === 'recording';
}

type View =
  | { kind: 'booting' }
  | { kind: 'setup' }
  | { kind: 'recording' }
  | { kind: 'history'; id: string }
  | { kind: 'familyPicking' }
  | { kind: 'transcript'; segments: TranscriptSegment[]; language: string; durationSec?: number; dumpId?: string }
  | { kind: 'note'; note: Note | NoteBase; dumpId?: string }
  | { kind: 'terms' }
  | { kind: 'connector' }
  | { kind: 'error'; message: string; permanent?: boolean; origin?: ErrorOrigin };

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
 * familyPicking | transcript | note | terms | error`) PLUS the sibling
 * `backgroundJob` axis (Task 6) and the onSessionError subscription. The v2
 * finalize flow runs in the BACKGROUND: Stop → familyPicking → pick starts a
 * backgroundJob + returns to recording → the chip carries progress/completion
 * (scenario 2: a new recording can start while the note generates).
 *
 * Why a function component instead of inlining into the gate: keeps the
 * boot sequence (model status, session error, finalize progress) gated behind
 * successful auth — the listeners and getModelStatus call have no reason to
 * fire on the SignInView and would be wasted work / log noise pre-sign-in.
 * The function-component split also means React unmounts AuthenticatedApp
 * on sign-out (future feature), automatically tearing down its listeners.
 */
function AuthenticatedApp() {
  const [view, setView] = useState<View>({ kind: 'booting' });
  // Background generation lane (Task 6) — sibling to `view`. A note/transcript
  // generation runs here while the foreground view stays interactive (scenario 2).
  const [backgroundJob, setBackgroundJob] = useState<BackgroundJob | null>(null);
  // Group G1 §5.7/§13 — once-only first-run audio-retention disclosure ack.
  // localStorage-backed (the ONLY renderer persistence pattern, same as
  // Recording.tsx's `lisna.language`). When false, the recording view shows
  // FirstRunAudioNotice instead of <Recording> (gate: shouldShowAudioNotice).
  const [audioNoticeAck, setAudioNoticeAck] = useState(
    () => localStorage.getItem('lisna.audioNoticeAck') === '1',
  );
  // LLM connector (Task 9) — surfaced to both family pickers (live +
  // History regen) so they can offer the Claude segmented control / upsell
  // banner. Fetched once on mount; re-fetched inline at the ConnectorView
  // onBack site below (the only place the connection state can change) —
  // the cheap correct trigger per the Task 8 carry-over ruling.
  const [connectorConnected, setConnectorConnected] = useState(false);

  useEffect(() => {
    let active = true;
    window.lisna.connectorStatus().then((s) => {
      if (active) setConnectorConnected(s.connected);
    });
    return () => { active = false; };
  }, []);

  // Session error (sidecar crash). Idempotent merge:
  //   - First push: transition to 'error' view.
  //   - Second push with permanent=true (give-up upgrade arriving after the
  //     transient handleSidecarExit push): keep the existing message but flip
  //     the permanent flag so ErrorView swaps to the Restart button.
  //   - Repeat transient pushes: ignored (keep first message).
  // This handles the supervisor's onExit-then-onCrash sequence: ipc.ts pushes
  // the transient message first, then handleSidecarGiveUp pushes the
  // permanent upgrade — both via the same channel.
  useEffect(() => {
    return window.lisna.onSessionError(({ message, permanent }) => {
      // Task 8: GENERATION_SIDECAR_DOWN is a non-blocking generation-lane failure
      // (the live capture is model-free and survives). Mark a RUNNING background
      // job failed; never take over the screen with the full ErrorView. If no
      // job is running, ignore — a pure recording is undisturbed by it.
      if (message.includes('GENERATION_SIDECAR_DOWN')) {
        setBackgroundJob((prev) => (prev && prev.status === 'running' ? { ...prev, status: 'error', message } : prev));
        return;
      }
      // Capture-lane / boot failures still BLOCK with the full-screen ErrorView.
      setView((prev) => {
        if (prev.kind === 'error') {
          // Already in error — only upgrade flag, don't overwrite message.
          return permanent && !prev.permanent ? { ...prev, permanent: true } : prev;
        }
        return { kind: 'error', message, permanent };
      });
    });
  }, []);

  // Finalize progress (founder ask 2026-06-13): main's onTelemetry forwards the
  // orchestrator's transcribe / attempt / chunk / finalize events. Task 6 folds
  // them into the BackgroundJob UNCONDITIONALLY (no view gate), so progress lands
  // while the foreground view is `recording` (scenario 2). A settled job ignores
  // trailing events; with no active job the event is dropped (applyBackgroundProgress).
  useEffect(() => {
    return window.lisna.onFinalizeProgress((msg) => {
      setBackgroundJob((prev) => applyBackgroundProgress(prev, msg));
    });
  }, []);

  // §5.1 — on mount, query main for the boot-resolved ModelStatus.
  // Safe to call here without race: main/index.ts registers models/status
  // BEFORE createWindow (Task 7), so the handler is always present by the
  // time this mounts. While in 'booting', the existing onSessionError
  // listener is naturally inert (its prev.kind guard no-ops).
  useEffect(() => {
    window.lisna
      .getModelStatus()
      .then((status) => {
        if (status.kind === 'ready') {
          setView({ kind: 'recording' });
          return;
        }
        // Auto-detect + in-app download (Task 3) handles every needs-setup
        // case unconditionally — no per-slot routing needed here anymore
        // (the manual picker fallback that consumed missing[0]/the derived
        // MODEL_FILE_MISSING_* code was removed in Task 5).
        setView({ kind: 'setup' });
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
          permanent: true,
        });
      });
  }, []);

  return (
    <div className="lz-app">
      {/* Hidden pencil SVG filters (Task 4) — defined ONCE here, referenced via
          filter:url(#pencil-rough) / url(#pencil-grain) from theme.css's
          .lz-onb-* pencil accents (wordmark, CTA border, progress fill, done
          check). Verbatim from web/src/app/layout.tsx's #pencil-rough per
          web-design.md — don't redefine per-component, it'd duplicate IDs. */}
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
        <defs>
          <filter id="pencil-rough" x="-6%" y="-6%" width="112%" height="112%">
            <feTurbulence type="fractalNoise" baseFrequency="0.05 1.2" numOctaves={2} seed={3} result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale={2.8} />
          </filter>
          <filter id="pencil-grain" x="-8%" y="-8%" width="116%" height="116%">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={1} seed={7} result="g" />
            <feDisplacementMap in="SourceGraphic" in2="g" scale={1.4} result="d" />
            <feTurbulence type="fractalNoise" baseFrequency="0.04 1.1" numOctaves={2} seed={3} result="r" />
            <feDisplacementMap in="d" in2="r" scale={2.4} />
          </filter>
        </defs>
      </svg>
      {/* Transparent draggable strip — the ONLY -webkit-app-region:drag surface.
          Replaces the removed header bar so the top edge + traffic-light zone
          stay draggable while content flows to the very top (theme.css .lz-titlebar). */}
      <div className="lz-titlebar" />
      <div className="lz-content" data-lz-scroll>
        {renderView(view, setView, backgroundJob, setBackgroundJob, audioNoticeAck, () => {
          localStorage.setItem('lisna.audioNoticeAck', '1');
          setAudioNoticeAck(true);
        }, connectorConnected, setConnectorConnected)}
      </div>
      {/* Scroll-gated top-fade overlay (theme.css .lz-topfade). Sibling AFTER
          .lz-content so `.lz-content[data-scrolled] ~ .lz-topfade` matches; this
          replaces the old mask, which broke .lz-content's custom scrollbar. */}
      <div className="lz-topfade" aria-hidden="true" />
      {/* Brand wordmark, top-left. Visible only at the very top; fades out as you
          scroll (inverse of .lz-topfade). Sibling AFTER .lz-content for the
          `.lz-content[data-scrolled] ~ .lz-wordmark` selector. */}
      <div className="lz-wordmark" aria-hidden="true">Lisna</div>
      <GenerationChip
        job={backgroundJob}
        onOpen={() => {
          if (!backgroundJob) return;
          if (backgroundJob.kind === 'note' && backgroundJob.note) {
            setView({ kind: 'note', note: backgroundJob.note, dumpId: backgroundJob.dumpId });
          } else if (backgroundJob.kind === 'transcript' && backgroundJob.transcript) {
            const t = backgroundJob.transcript;
            setView({ kind: 'transcript', segments: t.segments, language: t.language, durationSec: t.durationSec, dumpId: t.dumpId });
          }
          setBackgroundJob(null);
        }}
        onDismiss={() => setBackgroundJob(null)}
        onRetryOndevice={() => {
          // Task 10 — cloud-error → on-device fallback (spec §6, explicit offer
          // only). Re-runs the SAME family the failed job carried in `retry`,
          // via whichever entry point it came from (live vs. History regen).
          if (!backgroundJob || backgroundJob.kind !== 'note' || !backgroundJob.retry) return;
          const { family, fromDumpId } = backgroundJob.retry;
          setBackgroundJob({
            kind: 'note',
            status: 'running',
            progress: { phase: 'loading', startedAt: Date.now() },
            target: 'ondevice',
            retry: backgroundJob.retry,
          });
          if (fromDumpId) void runFinalizeFromDump(fromDumpId, family, 'ondevice', setBackgroundJob);
          else void runFinalize(family, 'ondevice', setBackgroundJob);
        }}
        onOpenConnectorSettings={() => setView({ kind: 'connector' })}
      />
    </div>
  );
}

function renderView(
  view: View,
  setView: (next: View | ((p: View) => View)) => void,
  backgroundJob: BackgroundJob | null,
  setBackgroundJob: SetBackgroundJob,
  audioNoticeAck: boolean,
  onAckAudioNotice: () => void,
  connectorConnected: boolean,
  setConnectorConnected: (connected: boolean) => void,
) {
  // Task 9 (ponytail: renderer guard, not a main-side queue): only one
  // generation at a time. The single backgroundJob can't track two, and a 2nd
  // beginGeneration throws FINALIZE_IN_FLIGHT in main anyway — so refuse to START
  // a 2nd while one runs. The chip shows the running job; founder confirmed
  // concurrent generation won't happen, this is the safety net.
  const genBusy = backgroundJob?.status === 'running';
  switch (view.kind) {
    case 'booting':
      return <div data-testid="booting" />;  // null UI; resolved in ~ms
    case 'setup':
      return <SetupView onReady={() => setView({ kind: 'recording' })} />;
    case 'recording':
      // Group G1 — gate the first recording behind the once-only on-device
      // audio-retention disclosure. This catches BOTH entry paths into
      // recording (boot-direct + post-setup), so capture cannot begin until the
      // user acknowledges. See shouldShowAudioNotice.
      if (shouldShowAudioNotice(audioNoticeAck, view.kind)) {
        return <FirstRunAudioNotice onAck={onAckAudioNotice} />;
      }
      return (
        <Recording
          onStop={(elapsedSec) =>
            setView((prev) => {
              if (prev.kind !== 'recording') return prev;
              // Too-short/empty tap: drop main-side session, stay on Recording for an
              // immediate retry. Real empty/silent audio is caught server-side
              // (EMPTY_RECORDING) once the WAV is transcribed at finalize.
              if (isEmptyRecording(elapsedSec)) {
                void window.lisna.discardSession();
                return { kind: 'recording' };
              }
              return { kind: 'familyPicking' };
            })
          }
          onError={(message) =>
            setView((prev) => {
              if (prev.kind === 'error') return prev;
              // Synchronous SIDECAR_GAVE_UP rejection (e.g. user clicked Start
              // after give-up, before any onSessionError push reached the
              // renderer): infer permanent here so the restart UX kicks in
              // without waiting for the IPC channel.
              const permanent = message.includes('SIDECAR_GAVE_UP') || undefined;
              return { kind: 'error', message, permanent };
            })
          }
          onOpenHistory={(id) => setView({ kind: 'history', id })}
          onOpenTerms={() => setView({ kind: 'terms' })}
          onOpenConnector={() => setView({ kind: 'connector' })}
          quickTranscriptBusy={genBusy}
          onQuickTranscript={(startSec, endSec) => {
            if (genBusy) return; // one generation at a time (also disabled in the button)
            // Scenario 1: transcribe the span in the background; stay on the
            // recording screen — the chip carries progress/completion.
            setBackgroundJob({ kind: 'transcript', status: 'running', progress: { phase: 'transcribing', startedAt: Date.now() } });
            void runTranscribeSpan(startSec, endSec, setBackgroundJob);
          }}
        />
      );
    case 'terms':
      return <TermsView onBack={() => setView({ kind: 'recording' })} />;
    case 'connector':
      return (
        <ConnectorView
          onBack={() => {
            setView({ kind: 'recording' });
            // Re-fetch on return — the only place connection state can
            // change (connect/disconnect both happen inside ConnectorView).
            void window.lisna.connectorStatus().then((s) => setConnectorConnected(s.connected));
          }}
        />
      );
    case 'history':
      return (
        <History
          id={view.id}
          onBack={() => setView({ kind: 'recording' })}
          connectorConnected={connectorConnected}
          onOpenConnector={() => setView({ kind: 'connector' })}
          onRegenerate={(family, target) => {
            if (genBusy) return; // Task 9: a generation is already running (chip shows it)
            // Background generation (Task 7): start the job, return to recording,
            // and let the chip carry progress/completion. The regen runs even
            // while a new recording captures (the lane is independent).
            setBackgroundJob({
              kind: 'note',
              status: 'running',
              progress: { phase: 'loading', startedAt: Date.now() },
              target,
              retry: { family, fromDumpId: view.id },
            });
            setView({ kind: 'recording' });
            void runFinalizeFromDump(view.id, family, target, setBackgroundJob);
          }}
        />
      );
    case 'familyPicking':
      // Task 9: one generation at a time. If one is running, hold the picker
      // (the chip shows progress); it re-renders to the picker when the job
      // settles. Recording B's session waits here until then.
      if (genBusy) {
        return <div className="lz-pad lz-muted">別の生成が進行中です。完了までお待ちください。</div>;
      }
      return (
        <FamilyPickerStep
          language={(() => {
            const v = localStorage.getItem('lisna.language');
            return v === 'en' || v === 'ko' ? v : 'ja';
          })()}
          connectorConnected={connectorConnected}
          onOpenConnector={() => setView({ kind: 'connector' })}
          onDiscard={() => {
            // Drop the session in main (clears SESSION_ACTIVE) and return to
            // Recording. Fire-and-forget: the handler is idempotent and the
            // UI transition must not block on IPC latency.
            void window.lisna.discardSession();
            setView({ kind: 'recording' });
          }}
          onPick={(choice, target) => {
            // Task 7: picking starts a BACKGROUND generation and returns the
            // foreground to `recording` — the chip carries progress/completion,
            // so the user can immediately start a NEW recording (scenario 2).
            if (choice === 'transcript') {
              setBackgroundJob({ kind: 'transcript', status: 'running', progress: { phase: 'transcribing', startedAt: Date.now() } });
              setView({ kind: 'recording' });
              void runTranscribe(setBackgroundJob);
              return;
            }
            setBackgroundJob({
              kind: 'note',
              status: 'running',
              progress: { phase: 'loading', startedAt: Date.now() },
              target,
              retry: { family: choice },
            });
            setView({ kind: 'recording' });
            void runFinalize(choice, target, setBackgroundJob);
          }}
        />
      );
    case 'transcript':
      return (
        <TranscriptView
          segments={view.segments}
          language={view.language}
          durationSec={view.durationSec}
          dumpId={view.dumpId}
          onNewSession={() => setView({ kind: 'recording' })}
        />
      );
    case 'note':
      return (
        <NoteView
          note={view.note}
          dumpId={view.dumpId}
          onNewSession={() => setView({ kind: 'recording' })}
        />
      );
    case 'error':
      return (
        <ErrorView
          message={view.message}
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
            setView({ kind: 'recording' });
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
export function retryViewFor(error: { origin?: ErrorOrigin }): View {
  return error.origin?.kind === 'dump'
    ? { kind: 'history', id: error.origin.id }
    : { kind: 'familyPicking' };
}

/**
 * Fold one main-pushed finalize-progress event into a ProgressState. Pure
 * (exported for tests; reused by applyBackgroundProgress). Every transition is
 * driven by a REAL orchestrator telemetry event — no simulated progress.
 *
 * `startedAt` is renderer-clock state set when the generation starts; it must
 * survive every transition because it feeds the elapsed-time line.
 */
export function applyFinalizeProgress(
  prev: ProgressState | null,
  msg: FinalizeProgressPayload,
): ProgressState | null {
  const startedAt = prev?.startedAt;
  switch (msg.kind) {
    // STT Phase 2a: whole-file transcription precedes note generation.
    case 'transcribe-start':
      // Enter the transcribing phase WITHOUT a pct — no fabricated progress
      // until the first real sttProgress event lands.
      return { phase: 'transcribing', startedAt };
    case 'transcribe-progress':
      return { phase: 'transcribing', pct: msg.pct, startedAt };
    case 'transcribe-done':
      // Transcription finished; the LLM loads next, so fall back to the
      // model-loading message until attempt-start switches to 'chunk'.
      return { phase: 'loading', startedAt };
    case 'attempt-start':
      return {
        phase: 'chunk',
        chunkIndex: msg.chunkIndex,
        totalChunks: msg.totalChunks,
        attempt: msg.attempt,
        attemptMax: msg.maxAttempts,
        startedAt,
      };
    case 'chunk-done': {
      if (msg.chunkIndex < msg.totalChunks - 1) {
        // Next chunk's prompt is being built; its attempt-start follows in
        // ms and fills the attempt counter back in.
        return {
          phase: 'chunk',
          chunkIndex: msg.chunkIndex + 1,
          totalChunks: msg.totalChunks,
          startedAt,
        };
      }
      // Last chunk: multi-chunk runs continue into the merge step (the
      // interview/brainstorm merge is a real LLM call — can take a while);
      // a single-chunk run has no merge, so keep the final chunk state until
      // finalize-done / the note arrives.
      return msg.totalChunks > 1 ? { phase: 'merge', startedAt } : prev;
    }
    case 'finalize-done':
      // Remaining work before the IPC promise resolves: result-dump write +
      // FSM settle — ms, rendered as the persist phase.
      return { phase: 'persist', startedAt };
    // Cloud (Claude connector) single-shot generation — Task 6. No chunk/attempt
    // granularity: cloud-start = request in flight; cloud-retry = a malformed
    // response was re-requested (carry `attempt` for the 再試行 hint).
    case 'cloud-start':
      return { phase: 'cloud', startedAt };
    case 'cloud-retry':
      return { phase: 'cloud', attempt: msg.attempt, startedAt };
  }
}

/**
 * Background generation lane (Task 6, spec §4.4) — a sibling axis to `view`.
 * A note/transcript generation runs in the BACKGROUND while the foreground view
 * (e.g. a NEW recording) stays interactive. The generation's progress folds here
 * (not into `view`), completion lands here (not a full-screen note view), and a
 * failure surfaces here (the chip), NOT the blocking ErrorView.
 */
export interface BackgroundJob {
  kind: 'note' | 'transcript';
  status: 'running' | 'done' | 'error';
  progress: ProgressState | null;
  /** Which pipeline is generating the note (Task 9). Present when
   *  kind==='note' — set at job creation and carried through unchanged by
   *  applyBackgroundProgress's spread. Undefined for 'transcript' jobs
   *  (no LLM, so no target axis). */
  target?: GenerationTarget;
  /** present when kind==='note' && status==='done' (the chip's "open" target). */
  note?: Note | NoteBase;
  /** source dump dir id for a note job (title.json key for NoteView editing).
   *  Undefined when the generation had no dump dir. */
  dumpId?: string;
  /** present when kind==='transcript' && status==='done'. */
  transcript?: { segments: TranscriptSegment[]; language: string; durationSec?: number; dumpId?: string };
  /** present when status==='error'. */
  message?: string;
  /** Task 10 — inputs needed to re-run this note job on the SAME family when
   *  it errors (cloud-error → on-device fallback, spec §6 "explicit offer,
   *  never silent"). Present only for kind==='note' jobs, set at job creation
   *  and carried through unchanged (like `target`). `fromDumpId` set ⇒ the
   *  job came from History regenerate (retry via finalizeFromDump); absent ⇒
   *  the live family-picker path (retry via finalize). Undefined for
   *  'transcript' jobs (nothing to re-run on a different target). */
  retry?: { family: NoteFamily; fromDumpId?: string };
}

type SetBackgroundJob = (next: BackgroundJob | null | ((p: BackgroundJob | null) => BackgroundJob | null)) => void;

/**
 * Fold one main-pushed finalize-progress event into the BackgroundJob (Task 6).
 * Pure (exported for tests). Folds UNCONDITIONALLY for a RUNNING job — no
 * `view.kind` gate — so progress lands while the foreground is `recording`
 * (scenario 2). A settled (done/error) job ignores trailing events; with no
 * active job the event is dropped. Reuses applyFinalizeProgress for the
 * ProgressState transition itself.
 */
export function applyBackgroundProgress(
  prev: BackgroundJob | null,
  msg: FinalizeProgressPayload,
): BackgroundJob | null {
  if (!prev || prev.status !== 'running') return prev;
  return { ...prev, progress: applyFinalizeProgress(prev.progress, msg) };
}

/**
 * Runs the v2 finalize IPC into the BackgroundJob (Task 7). On success the note
 * lands on the job (the chip's "open" shows it — History regen would re-run the
 * LLM); on failure the job goes to 'error' (the chip surfaces it non-blockingly,
 * NOT the full-screen ErrorView). The functional updates no-op if the job was
 * dismissed/replaced mid-flight.
 */
async function runFinalize(family: NoteFamily, target: GenerationTarget, setBackgroundJob: SetBackgroundJob): Promise<void> {
  try {
    const result = await window.lisna.finalize({ family, target });
    setBackgroundJob((prev) => (prev ? { ...prev, status: 'done', note: result.note, dumpId: result.dumpId } : prev));
  } catch (err) {
    const message = String((err as Error)?.message ?? err);
    setBackgroundJob((prev) => (prev ? { ...prev, status: 'error', message } : prev));
  }
}

/** Transcript-only path ("文字起こし") into the BackgroundJob — no LLM. */
async function runTranscribe(setBackgroundJob: SetBackgroundJob): Promise<void> {
  try {
    const r = await window.lisna.transcribeOnly();
    setBackgroundJob((prev) =>
      prev
        ? { ...prev, status: 'done', transcript: { segments: r.segments, language: r.language, durationSec: r.durationSec, dumpId: r.dumpId } }
        : prev,
    );
  } catch (err) {
    const message = String((err as Error)?.message ?? err);
    setBackgroundJob((prev) => (prev ? { ...prev, status: 'error', message } : prev));
  }
}

/**
 * Quick-transcript slice (Phase 2, scenario 1) into the BackgroundJob. The long
 * recording keeps running; the chip carries the slice transcript's progress +
 * completion (open → TranscriptView).
 */
async function runTranscribeSpan(startSec: number, endSec: number, setBackgroundJob: SetBackgroundJob): Promise<void> {
  try {
    const r = await window.lisna.transcribeSpan({ startSec, endSec });
    setBackgroundJob((prev) =>
      prev
        ? { ...prev, status: 'done', transcript: { segments: r.segments, language: r.language, durationSec: r.durationSec, dumpId: r.dumpId } }
        : prev,
    );
  } catch (err) {
    const message = String((err as Error)?.message ?? err);
    setBackgroundJob((prev) => (prev ? { ...prev, status: 'error', message } : prev));
  }
}

/** From-dump twin of runFinalize (History regenerate) into the BackgroundJob. */
async function runFinalizeFromDump(id: string, family: NoteFamily, target: GenerationTarget, setBackgroundJob: SetBackgroundJob): Promise<void> {
  try {
    const result = await window.lisna.finalizeFromDump({ id, family, target });
    setBackgroundJob((prev) => (prev ? { ...prev, status: 'done', note: result.note, dumpId: result.dumpId } : prev));
  } catch (err) {
    const message = String((err as Error)?.message ?? err);
    setBackgroundJob((prev) => (prev ? { ...prev, status: 'error', message } : prev));
  }
}

/**
 * Compact running-progress hint for the chip (no fabricated progress). The
 * cloud (Claude connector) path is a single-shot LLM call with no
 * chunk/attempt granularity to show — Task 10 shows elapsed time there
 * instead, so the running chip doesn't look frozen for the ~10-60s request.
 * `now` is passed in (not read via Date.now() here) so this stays pure and
 * directly unit-testable; the live tick comes from GenerationChip's effect.
 */
export function backgroundProgressHint(p: ProgressState | null, now: number): string {
  if (!p) return '';
  if (p.phase === 'transcribing' && p.pct != null) return `${p.pct}%`;
  if (p.phase === 'chunk' && p.totalChunks) return `${(p.chunkIndex ?? 0) + 1}/${p.totalChunks}`;
  if (p.phase === 'cloud' && p.startedAt !== undefined) return formatElapsed((now - p.startedAt) / 1000);
  return '';
}

/**
 * Task 10 (spec §6 "explicit offer, never silent fallback") — which recovery
 * actions the error chip offers for a failed note job. Only a CLOUD (target
 * 'claude') failure gets the on-device fallback offer; on-device failures and
 * transcript jobs are unchanged (History remains the existing recovery path
 * for those). The two connector-setup codes additionally offer a shortcut
 * straight into the connector settings — re-typing the same broken/missing
 * key would just fail again. Pure (exported for tests); matches
 * `message` against `toFriendlyJa`'s substring-match convention so a wrapped
 * error string (`'Error: CONNECTOR_NO_KEY at ...'`) still resolves.
 */
export type ChipErrorAction = 'retry-ondevice' | 'open-settings';

export function resolveCloudErrorActions(
  target: GenerationTarget | undefined,
  message: string | undefined,
): ChipErrorAction[] {
  if (target !== 'claude') return [];
  const raw = message ?? '';
  const needsSettings = raw.includes('CONNECTOR_NO_KEY') || raw.includes('CONNECTOR_AUTH_INVALID');
  return needsSettings ? ['retry-ondevice', 'open-settings'] : ['retry-ondevice'];
}

/**
 * Overlaid generation status chip (Task 6/7/8). Renders regardless of `view` —
 * including on the recording screen — so a background generation is visible
 * without taking over the UI. Done → "開く" (opens the result; History regen
 * would re-run the LLM, so this is the cheap path to the just-made note).
 * Error → non-blocking dismiss (recover via History list when idle); a cloud
 * (Claude) failure additionally shows the friendly error text and an explicit
 * on-device fallback offer (Task 10, spec §6 — never silent-fallback).
 *
 * Exported for structural tests (renderToStaticMarkup — no DOM env in this
 * package's vitest config); the button click wiring itself is verified in the
 * live app, same convention as HistoryList/NoteView/History.
 */
export function GenerationChip({
  job,
  onOpen,
  onDismiss,
  onRetryOndevice,
  onOpenConnectorSettings,
}: {
  job: BackgroundJob | null;
  onOpen: () => void;
  onDismiss: () => void;
  /** Task 10 — re-runs the same failed note job with target 'ondevice'. */
  onRetryOndevice: () => void;
  /** Task 10 — routes to the connector settings view (CONNECTOR_NO_KEY / AUTH_INVALID). */
  onOpenConnectorSettings: () => void;
}) {
  // Hooks stay above the null early-return (React hook-order rule), mirroring
  // NoteRenderProgress's ticking pattern. The cloud phase is a single-shot LLM
  // call with few discrete progress events, so without a tick the elapsed hint
  // would look frozen between cloud-start and the (possibly late) cloud-retry.
  const [now, setNow] = useState(() => Date.now());
  const ticking = job?.status === 'running' && job.progress?.phase === 'cloud';
  useEffect(() => {
    if (!ticking) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ticking]);

  if (!job) return null;
  // Task 9: a note job generated via the Claude connector gets a distinct
  // label (spec section 4 step 3's "cloud indicator") so the running/done/error
  // states read differently from the on-device pipeline.
  const label = job.kind === 'note' ? (job.target === 'claude' ? 'Claudeノート' : 'ノート') : '文字起こし';
  const pos: CSSProperties = { position: 'fixed', right: 18, bottom: 18 };
  const x: CSSProperties = { background: 'transparent', border: 0, padding: '2px 4px', color: 'var(--lz-text-3)', fontSize: 14 };
  if (job.status === 'running') {
    const hint = backgroundProgressHint(job.progress, now);
    return (
      <div className="lz-chip" style={pos} data-testid="gen-chip-running">
        <span className="lz-chip-dot"></span>
        <span style={{ fontWeight: 500 }}>{`${label}生成中`}</span>
        {hint && <span className="lz-muted">{hint}</span>}
      </div>
    );
  }
  if (job.status === 'done') {
    return (
      <div className="lz-chip" style={pos} data-testid="gen-chip-done">
        <span className="lz-chip-dot ok"></span>
        <span style={{ fontWeight: 500 }}>{`${label}完成`}</span>
        <button onClick={onOpen} style={{ padding: '4px 10px', fontSize: 12 }}>開く</button>
        <button onClick={onDismiss} aria-label="閉じる" style={x}>✕</button>
      </div>
    );
  }
  // status === 'error'
  const actions = job.kind === 'note' ? resolveCloudErrorActions(job.target, job.message) : [];
  const isCloudNote = job.kind === 'note' && job.target === 'claude';
  return (
    <div className="lz-chip" style={pos} data-testid="gen-chip-error">
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--lz-accent)' }}></span>
      <span style={{ fontWeight: 500 }}>{`${label}生成失敗`}</span>
      {isCloudNote && job.message && <span className="lz-muted">{toFriendlyJa(job.message)}</span>}
      {actions.includes('retry-ondevice') && (
        <button onClick={onRetryOndevice} style={{ padding: '4px 10px', fontSize: 12 }} data-testid="gen-chip-retry-ondevice">
          オンデバイスで再生成
        </button>
      )}
      {actions.includes('open-settings') && (
        <button onClick={onOpenConnectorSettings} style={{ padding: '4px 10px', fontSize: 12 }} data-testid="gen-chip-open-settings">
          設定を開く
        </button>
      )}
      <button onClick={onDismiss} aria-label="閉じる" style={x}>✕</button>
    </div>
  );
}
