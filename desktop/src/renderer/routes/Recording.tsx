import { useEffect, useRef, useState } from 'react';
import type { RecordingSource } from '@shared/ipc-protocol';
import type { TranscriptSegment } from '@shared/types';
import { RecordingOrchestrator } from '../audio/orchestrator';
import { createCapturer } from '../audio/worklet-capturer';
import { SystemAudioUnavailableNotice } from '../components/SystemAudioUnavailableNotice';

export function Recording() {
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [chunks, setChunks] = useState(0);
  const [source, setSource] = useState<RecordingSource>('mic');
  // Pessimistic default: assume system audio is unavailable until the
  // capabilities round-trip confirms it. A slow IPC response should NOT
  // let the user click the system radio and then fail downstream.
  const [systemAudioAvailable, setSystemAudioAvailable] = useState(false);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const orchRef = useRef<RecordingOrchestrator | null>(null);
  // Synchronous re-entry guard. A useState-only guard is racy because setState
  // is async — a second click that arrives before the next React render still
  // sees the old `running=false` and slips through. Live smoke test on
  // 2026-05-13 produced two parallel orchestrators sharing one mic stream and
  // emitting duplicate-index chunks (e.g. "chunk received 0 32000 samples"
  // twice). A ref flips synchronously and closes that window.
  const startingRef = useRef(false);
  // Synchronous session-active guard. setRunning is async — a late transcribe()
  // result that resolves after the user clicks Stop must not land in the next
  // session's captions. runningRef flips synchronously so the onChunk gate is
  // reliable even before the next React render cycle.
  const runningRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void window.lisna.capabilities().then((caps) => {
      if (!cancelled) setSystemAudioAvailable(caps.systemAudio);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Subscribe to STT segment results pushed from the main process.
  // Returns an unsubscribe function so Strict Mode double-mounts don't stack listeners.
  // Guard on runningRef: late results from a stopped session are silently dropped
  // so they cannot bleed into the next session's captions.
  useEffect(() => {
    const unsub = window.lisna.onChunk((msg) => {
      if (!runningRef.current) return;
      setSegments((prev) => [...prev, ...msg.segments]);
    });
    return unsub;
  }, []);

  // Unmount cleanup. If the component unmounts while a recording is active
  // (Strict Mode dev double-mount, route nav, app close) the orchestrator
  // keeps consuming mic samples and the main-side `recording=true` flag leaks
  // forever. This effect's cleanup tears both down — best-effort, never throws.
  useEffect(() => {
    return () => {
      const orch = orchRef.current;
      orchRef.current = null;
      if (orch) void orch.stop();
      void window.lisna.stopRecording().catch(() => {
        /* best-effort */
      });
    };
  }, []);

  async function start() {
    if (running || startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    setSegments([]);
    try {
      await window.lisna.startRecording(source);
      // If orchestrator init fails (worklet load, mic permission, AudioContext),
      // the main side already flipped to recording=true — roll it back so the
      // next Start click can re-enter cleanly. Without this, a single failure
      // wedges the app: main thinks it's recording forever, renderer's button
      // says "Start", and we double-register on the next click.
      const orch = new RecordingOrchestrator({
        capturerFactory: (s) => createCapturer(s),
        sender: (chunk) => {
          setChunks((c) => c + 1);
          void window.lisna.sendChunk(chunk);
        },
      });
      orchRef.current = orch;
      await orch.start(source);
      runningRef.current = true;
      setRunning(true);
    } catch (err) {
      orchRef.current = null;
      await window.lisna.stopRecording().catch(() => {
        /* best-effort rollback — don't mask the original error */
      });
      console.error('Recording start failed', err);
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  }

  async function stop() {
    runningRef.current = false;
    setSegments([]);
    const orch = orchRef.current;
    orchRef.current = null;
    if (orch) await orch.stop();
    await window.lisna.stopRecording();
    setRunning(false);
  }

  return <section>
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
      {running ? 'Stop' : starting ? 'Starting…' : 'Start'}
    </button>
    <p>Chunks captured: {chunks}</p>
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
  </section>;
}
