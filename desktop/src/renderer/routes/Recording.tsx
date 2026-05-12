import { useState, useRef } from 'react';

export function Recording() {
  const [running, setRunning] = useState(false);
  const [chunks, setChunks] = useState(0);
  const unsubRef = useRef<(() => void) | null>(null);

  async function start() {
    if (running) return;
    await window.lisna.startRecording('mic');
    setRunning(true);
    unsubRef.current = window.lisna.onChunk(() => setChunks(c => c + 1));
  }
  async function stop() {
    await window.lisna.stopRecording();
    setRunning(false);
    unsubRef.current?.();
    unsubRef.current = null;
  }

  return <section>
    <h2>Recording (Phase 1 stub)</h2>
    <button onClick={running ? stop : start}>{running ? 'Stop' : 'Start'}</button>
    <p>Chunks captured: {chunks}</p>
  </section>;
}
