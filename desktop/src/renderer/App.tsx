import { useEffect, useState } from 'react';
import { Recording } from './routes/Recording';
import { NoteView } from './routes/NoteView';
import { ErrorView } from './routes/ErrorView';
import { FinalizingView } from './routes/FinalizingView';
import type { Note, TranscriptSegment } from '@shared/types';
import type { SessionPhase } from '@shared/ipc-protocol';

type FinalizingPhase = Exclude<SessionPhase, 'stt-loading'>;

type View =
  | { kind: 'recording'; segments: TranscriptSegment[] }
  | { kind: 'finalizing'; phase: FinalizingPhase; segments: TranscriptSegment[] }
  | { kind: 'note'; note: Note }
  | { kind: 'error'; message: string; segments: TranscriptSegment[]; permanent?: boolean };

export function App() {
  const [view, setView] = useState<View>({ kind: 'recording', segments: [] });

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

  return (
    <main style={{ fontFamily: 'system-ui', padding: 24 }}>
      <h1>Lisna v2 — on-device</h1>
      {renderView(view, setView)}
    </main>
  );
}

function renderView(view: View, setView: (next: View | ((p: View) => View)) => void) {
  switch (view.kind) {
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
