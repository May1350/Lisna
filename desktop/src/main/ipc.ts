import { ipcMain } from 'electron';

export const CHANNELS = {
  startRecording: 'recording/start',
  stopRecording: 'recording/stop',
  /** renderer → main: a finalized PCM chunk for downstream STT */
  chunk: 'recording/chunk',
  /** main → renderer: UI notification that a chunk was received/processed */
  onChunk: 'recording/onChunk',
} as const;

export interface IncomingChunkPayload {
  index: number;
  source: 'mic' | 'system';
  startMs: number;
  endMs: number;
  samples: Float32Array;
}

export function registerIpc() {
  ipcMain.handle(CHANNELS.startRecording, async (_e, opts: { source: 'mic' | 'system' }) => {
    // Phase 1 후속 task 에서 audio/index.ts 의 startRecording 호출로 교체
    return { ok: true, source: opts.source };
  });
  ipcMain.handle(CHANNELS.stopRecording, async () => ({ ok: true }));
  ipcMain.handle(CHANNELS.chunk, async (_e, payload: IncomingChunkPayload) => {
    // Sanity log. Phase 2 will pipe `payload.samples` into the whisper sidecar.
    console.log('chunk received', payload.index, payload.samples.length, 'samples');
    return { ok: true };
  });
}
