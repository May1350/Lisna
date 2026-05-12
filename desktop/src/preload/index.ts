import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS } from '../main/ipc';

contextBridge.exposeInMainWorld('lisna', {
  startRecording: (source: 'mic' | 'system') => ipcRenderer.invoke(CHANNELS.startRecording, { source }),
  stopRecording: () => ipcRenderer.invoke(CHANNELS.stopRecording),
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
      onChunk(cb: (chunk: { index: number; durationMs: number }) => void): () => void;
    };
  }
}
