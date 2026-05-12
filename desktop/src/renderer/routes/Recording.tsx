import { useState, useRef } from 'react';
import { RecordingOrchestrator } from '../audio/orchestrator';
import { createCapturer } from '../audio/worklet-capturer';

export function Recording() {
  const [running, setRunning] = useState(false);
  const [chunks, setChunks] = useState(0);
  const orchRef = useRef<RecordingOrchestrator | null>(null);

  async function start() {
    if (running) return;
    await window.lisna.startRecording('mic');
    const orch = new RecordingOrchestrator({
      capturerFactory: (source) => createCapturer(source),
      sender: (chunk) => {
        setChunks((c) => c + 1);
        void window.lisna.sendChunk(chunk);
      },
    });
    orchRef.current = orch;
    await orch.start('mic');
    setRunning(true);
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
    <button onClick={running ? stop : start}>{running ? 'Stop' : 'Start'}</button>
    <p>Chunks captured: {chunks}</p>
  </section>;
}
