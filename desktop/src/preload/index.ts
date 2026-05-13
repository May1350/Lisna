import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS } from '../main/ipc';
import type { Capabilities, ChunkPayload, ChunkResultPayload } from '@shared/ipc-protocol';

contextBridge.exposeInMainWorld('lisna', {
  startRecording: (source: 'mic' | 'system') => ipcRenderer.invoke(CHANNELS.startRecording, { source }),
  stopRecording: () => ipcRenderer.invoke(CHANNELS.stopRecording),
  sendChunk: (chunk: ChunkPayload) => ipcRenderer.invoke(CHANNELS.chunk, chunk),
  capabilities: () => ipcRenderer.invoke(CHANNELS.capabilities),
  /**
   * Subscribe to STT segment results pushed from the main process after each
   * chunk. Returns an unsubscribe function — call it in `useEffect` cleanup to
   * avoid duplicate listeners across Strict Mode double-mounts.
   */
  onChunk: (cb: (msg: ChunkResultPayload) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, msg: ChunkResultPayload) => cb(msg);
    ipcRenderer.on(CHANNELS.onChunk, listener);
    return () => ipcRenderer.removeListener(CHANNELS.onChunk, listener);
  },
});

declare global {
  interface Window {
    lisna: {
      startRecording(source: 'mic' | 'system'): Promise<{ ok: boolean; source: string }>;
      stopRecording(): Promise<{ ok: boolean }>;
      sendChunk(chunk: ChunkPayload): Promise<{ ok: boolean }>;
      capabilities(): Promise<Capabilities>;
      onChunk(cb: (msg: ChunkResultPayload) => void): () => void;
    };
  }
}
