import { ipcMain } from 'electron';
import type { ChunkPayload } from '@shared/ipc-protocol';

export const CHANNELS = {
  startRecording: 'recording/start',
  stopRecording: 'recording/stop',
  /** renderer → main: a finalized PCM chunk for downstream STT */
  chunk: 'recording/chunk',
} as const;

export function registerIpc() {
  ipcMain.handle(CHANNELS.startRecording, async (_e, opts: { source: 'mic' | 'system' }) => {
    // Phase 1 후속 task 에서 audio/index.ts 의 startRecording 호출로 교체
    return { ok: true, source: opts.source };
  });
  ipcMain.handle(CHANNELS.stopRecording, async () => ({ ok: true }));
  ipcMain.handle(CHANNELS.chunk, async (_e, payload: ChunkPayload) => {
    // Sanity log. Phase 2 will pipe `payload.samples` into the whisper sidecar.
    console.log('chunk received', payload.index, payload.samples.length, 'samples');
    return { ok: true };
  });
}
