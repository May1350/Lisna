import { useEffect, useRef, useState } from 'react';
import type { RecordingSource } from '@shared/ipc-protocol';
import type { TranscriptSegment, Note } from '@shared/types';
import { RecordingOrchestrator } from '../audio/orchestrator';
import { createCapturer } from '../audio/worklet-capturer';
import { SystemAudioUnavailableNotice } from '../components/SystemAudioUnavailableNotice';

interface Props {
  segments: TranscriptSegment[];
  onFinalizing: () => void;
  onNote: (note: Note) => void;
  onError: (message: string) => void;
}

export function Recording({ segments, onFinalizing, onNote, onError }: Props) {
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [source, setSource] = useState<RecordingSource>('mic');
  // Pessimistic default: assume system audio is unavailable until the
  // capabilities round-trip confirms it. A slow IPC response should NOT
  // let the user click the system radio and then fail downstream.
  const [systemAudioAvailable, setSystemAudioAvailable] = useState(false);
  const orchRef = useRef<RecordingOrchestrator | null>(null);
  // Synchronous re-click guard within a single component instance. setState is
  // async — a second click that arrives before the next React render still
  // sees the old `running=false` and slips through. A ref flips synchronously
  // and closes that window. (React Strict Mode creates a new component
  // instance per mount cycle, so refs are recreated, not "preserved" — the
  // guard is per-instance.)
  const startingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void window.lisna.capabilities().then((caps) => {
      if (!cancelled) setSystemAudioAvailable(caps.systemAudio);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Unmount cleanup. If the component unmounts while a recording is active
  // (Strict Mode dev double-mount, app close), tear down the audio
  // orchestrator + recording/stop. Early-return if orchRef is already null —
  // normal stop() path nulls it before unmount, so this catches only the
  // abnormal teardown.
  useEffect(() => {
    return () => {
      const orch = orchRef.current;
      if (!orch) return;
      orchRef.current = null;
      void orch.stop();
      void window.lisna.stopRecording().catch(() => {
        /* best-effort */
      });
    };
  }, []);

  async function start() {
    if (running || startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    try {
      // Audio first, session/start last. Three reasons:
      //   1. macOS TCC mic-permission prompt can take up to 30s on first
      //      launch. Loading STT in parallel wastes RSS-time.
      //   2. If audio init fails after session/start succeeded, we'd need a
      //      session/cancel IPC to release STT — extra surface area.
      //   3. Chunks during STT load are dropped server-side (main's
      //      `recording === false`). At 16kHz/2s chunks the lost window is
      //      ≤1 chunk; accepted v2.0.
      await window.lisna.startRecording(source);
      const orch = new RecordingOrchestrator({
        capturerFactory: (s) => createCapturer(s),
        sender: (chunk) => {
          void window.lisna.sendChunk(chunk);
        },
      });
      orchRef.current = orch;
      await orch.start(source);
      // Now mic is capturing. Chunks send but main drops them until session/start completes.
      await window.lisna.startSession({ language: 'ja' });  // TODO(v2.1): settings UI for language
      setRunning(true);
    } catch (err) {
      // Cleanup: tear down whatever started.
      const orch = orchRef.current;
      orchRef.current = null;
      if (orch) await orch.stop().catch(() => {});
      await window.lisna.stopRecording().catch(() => {});
      console.error('Start failed', err);
      onError(String((err as Error)?.message ?? err));
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  }

  async function stop() {
    const orch = orchRef.current;
    orchRef.current = null;
    if (orch) await orch.stop();
    await window.lisna.stopRecording();
    // SYNC transition: App enters 'finalizing' view BEFORE stopSession await
    // so the phase indicator UI shows while orchestrator.stop runs.
    onFinalizing();
    try {
      const note = await window.lisna.stopSession();
      onNote(note);
    } catch (err) {
      const message = String((err as Error)?.message ?? err);
      // APP_QUIT: window is dying anyway, no point showing the error view.
      if (message.includes('APP_QUIT')) return;
      onError(message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <section>
      <h2>Recording</h2>
      <fieldset disabled={running || starting}>
        <legend>Source</legend>
        <label>
          <input
            type="radio"
            name="source"
            value="mic"
            checked={source === 'mic'}
            onChange={() => setSource('mic')}
          />
          Microphone
        </label>
        <label>
          <input
            type="radio"
            name="source"
            value="system"
            checked={source === 'system'}
            disabled={!systemAudioAvailable}
            onChange={() => setSource('system')}
          />
          System audio
        </label>
      </fieldset>
      {!systemAudioAvailable && <SystemAudioUnavailableNotice />}
      <button disabled={starting} onClick={running ? stop : start}>
        {running ? 'Stop' : starting ? 'Loading model…' : 'Start'}
      </button>
      {segments.length > 0 && (
        <div>
          <h3>Live captions</h3>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {segments.map((seg, i) => (
              <li key={i} style={{ fontFamily: 'monospace', marginBottom: '0.25em' }}>
                [{seg.startSec.toFixed(1)}] {seg.text}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
