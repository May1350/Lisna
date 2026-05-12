import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS, type IncomingChunkPayload } from '../main/ipc';

contextBridge.exposeInMainWorld('lisna', {
  startRecording: (source: 'mic' | 'system') => ipcRenderer.invoke(CHANNELS.startRecording, { source }),
  stopRecording: () => ipcRenderer.invoke(CHANNELS.stopRecording),
  sendChunk: (chunk: IncomingChunkPayload) => ipcRenderer.invoke(CHANNELS.chunk, chunk),
  onChunk: (cb: (chunk: { index: number; durationMs: number }) => void) => {
    const sub = (_: unknown, payload: { index: number; durationMs: number }) => cb(payload);
    ipcRenderer.on(CHANNELS.onChunk, sub);
    return () => ipcRenderer.off(CHANNELS.onChunk, sub);
  },
});

declare global {
  interface Window {
    lisna: {
      startRecording(source: 'mic' | 'system'): Promise<{ ok: boolean; source: string }>;
      stopRecording(): Promise<{ ok: boolean }>;
      sendChunk(chunk: IncomingChunkPayload): Promise<{ ok: boolean }>;
      onChunk(cb: (chunk: { index: number; durationMs: number }) => void): () => void;
    };
  }
}
