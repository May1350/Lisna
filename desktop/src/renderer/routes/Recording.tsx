import { useState } from 'react';

export function Recording() {
  const [running, setRunning] = useState(false);
  const [chunks, setChunks] = useState(0);

  async function start() {
    await window.lisna.startRecording('mic');
    setRunning(true);
    window.lisna.onChunk(() => setChunks(c => c + 1));
  }
  async function stop() { await window.lisna.stopRecording(); setRunning(false); }

  return <section>
    <h2>Recording (Phase 1 stub)</h2>
    <button onClick={running ? stop : start}>{running ? 'Stop' : 'Start'}</button>
    <p>Chunks captured: {chunks}</p>
  </section>;
}
