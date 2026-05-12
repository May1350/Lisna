import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS } from '../main/ipc';
import type { ChunkPayload } from '@shared/ipc-protocol';

contextBridge.exposeInMainWorld('lisna', {
  startRecording: (source: 'mic' | 'system') => ipcRenderer.invoke(CHANNELS.startRecording, { source }),
  stopRecording: () => ipcRenderer.invoke(CHANNELS.stopRecording),
  sendChunk: (chunk: ChunkPayload) => ipcRenderer.invoke(CHANNELS.chunk, chunk),
});

declare global {
  interface Window {
    lisna: {
      startRecording(source: 'mic' | 'system'): Promise<{ ok: boolean; source: string }>;
      stopRecording(): Promise<{ ok: boolean }>;
      sendChunk(chunk: ChunkPayload): Promise<{ ok: boolean }>;
    };
  }
}
