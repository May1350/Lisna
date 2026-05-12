import { ipcMain } from 'electron';

export const CHANNELS = {
  startRecording: 'recording/start',
  stopRecording: 'recording/stop',
  onChunk: 'recording/chunk',
} as const;

export function registerIpc() {
  ipcMain.handle(CHANNELS.startRecording, async (_e, opts: { source: 'mic' | 'system' }) => {
    // Phase 1 후속 task 에서 audio/index.ts 의 startRecording 호출로 교체
    return { ok: true, source: opts.source };
  });
  ipcMain.handle(CHANNELS.stopRecording, async () => ({ ok: true }));
}
