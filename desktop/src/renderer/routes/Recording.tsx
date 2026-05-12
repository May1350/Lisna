import { useEffect, useRef, useState } from 'react';
import type { RecordingSource } from '@shared/ipc-protocol';
import { RecordingOrchestrator } from '../audio/orchestrator';
import { createCapturer } from '../audio/worklet-capturer';
import { SystemAudioUnavailableNotice } from '../components/SystemAudioUnavailableNotice';

export function Recording() {
  const [running, setRunning] = useState(false);
  const [chunks, setChunks] = useState(0);
  const [source, setSource] = useState<RecordingSource>('mic');
  // Pessimistic default: assume system audio is unavailable until the
  // capabilities round-trip confirms it. A slow IPC response should NOT
  // let the user click the system radio and then fail downstream.
  const [systemAudioAvailable, setSystemAudioAvailable] = useState(false);
  const orchRef = useRef<RecordingOrchestrator | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.lisna.capabilities().then((caps) => {
      if (!cancelled) setSystemAudioAvailable(caps.systemAudio);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function start() {
    if (running) return;
    await window.lisna.startRecording(source);
    // If orchestrator init fails (worklet load, mic permission, AudioContext),
    // the main side already flipped to recording=true — roll it back so the
    // next Start click can re-enter cleanly. Without this, a single failure
    // wedges the app: main thinks it's recording forever, renderer's button
    // says "Start", and we double-register on the next click.
    try {
      const orch = new RecordingOrchestrator({
        capturerFactory: (s) => createCapturer(s),
        sender: (chunk) => {
          setChunks((c) => c + 1);
          void window.lisna.sendChunk(chunk);
        },
      });
      orchRef.current = orch;
      await orch.start(source);
      setRunning(true);
    } catch (err) {
      orchRef.current = null;
      await window.lisna.stopRecording().catch(() => {
        /* best-effort rollback — don't mask the original error */
      });
      console.error('Recording start failed', err);
    }
  }

  async function stop() {
    const orch = orchRef.current;
    orchRef.current = null;
    if (orch) await orch.stop();
    await window.lisna.stopRecording();
    setRunning(false);
  }

  return <section>
    <h2>Recording (Phase 1 stub)</h2>
    <fieldset disabled={running}>
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
    <button onClick={running ? stop : start}>{running ? 'Stop' : 'Start'}</button>
    <p>Chunks captured: {chunks}</p>
  </section>;
}
