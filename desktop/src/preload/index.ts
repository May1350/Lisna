import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS } from '../main/ipc';
import type {
  Capabilities,
  ChunkPayload,
  ChunkResultPayload,
  SessionStartPayload,
  SessionPhasePayload,
  SessionErrorPayload,
  ModelStatus,
  ModelSlot,
  PickResult,
  ModelPickPayload,
} from '@shared/ipc-protocol';
import type { Note } from '@shared/types';

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

  // --- Step 4 additions ---

  startSession: ({ language }: SessionStartPayload): Promise<void> =>
    ipcRenderer.invoke(CHANNELS.sessionStart, { language }),

  stopSession: (): Promise<Note> =>
    ipcRenderer.invoke(CHANNELS.sessionStop),

  /**
   * Subscribe to phase indicator events during session/start and session/stop.
   * Returns an unsubscribe function.
   */
  onPhase: (cb: (msg: SessionPhasePayload) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, msg: SessionPhasePayload) => cb(msg);
    ipcRenderer.on(CHANNELS.sessionPhase, listener);
    return () => ipcRenderer.removeListener(CHANNELS.sessionPhase, listener);
  },

  /**
   * Subscribe to async session errors (sidecar crash mid-session). Returns an
   * unsubscribe function. NOTE: synchronous IPC rejections from session/start
   * or session/stop come via the invoke promise's catch — this channel covers
   * the asynchronous out-of-band case only.
   */
  onSessionError: (cb: (msg: SessionErrorPayload) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, msg: SessionErrorPayload) => cb(msg);
    ipcRenderer.on(CHANNELS.sessionError, listener);
    return () => ipcRenderer.removeListener(CHANNELS.sessionError, listener);
  },

  /**
   * Step 5 §3.6 — fire-and-forget restart. Calls main's lifecycle/restart IPC
   * which runs `app.relaunch() + app.quit()`. The current window's webContents
   * will be torn down by the resulting before-quit cycle, so the returned
   * promise typically never settles client-side — the caller should not await.
   */
  restartApp: (): Promise<void> => ipcRenderer.invoke(CHANNELS.lifecycleRestart),

  // --- Step 5 §5.1 — first-run model resolver ---

  getModelStatus: (): Promise<ModelStatus> =>
    ipcRenderer.invoke(CHANNELS.modelStatus),

  pickModel: (slot: ModelSlot): Promise<PickResult> => {
    const payload: ModelPickPayload = { slot };
    return ipcRenderer.invoke(CHANNELS.modelPick, payload);
  },

  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke(CHANNELS.shellOpenExternal, { url }),
});

declare global {
  interface Window {
    lisna: {
      startRecording(source: 'mic' | 'system'): Promise<{ ok: boolean; source: string }>;
      stopRecording(): Promise<{ ok: boolean }>;
      sendChunk(chunk: ChunkPayload): Promise<{ ok: boolean }>;
      capabilities(): Promise<Capabilities>;
      onChunk(cb: (msg: ChunkResultPayload) => void): () => void;
      startSession(payload: SessionStartPayload): Promise<void>;
      stopSession(): Promise<Note>;
      onPhase(cb: (msg: SessionPhasePayload) => void): () => void;
      onSessionError(cb: (msg: SessionErrorPayload) => void): () => void;
      restartApp(): Promise<void>;
      getModelStatus(): Promise<ModelStatus>;
      pickModel(slot: ModelSlot): Promise<PickResult>;
      openExternal(url: string): Promise<void>;
    };
  }
}
