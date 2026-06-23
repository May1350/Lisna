import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS } from '../main/ipc';
import type {
  AuthState,
  Capabilities,
  ChunkPayload,
  SessionStartPayload,
  SessionErrorPayload,
  FinalizeProgressPayload,
  ModelStatus,
  ModelSlot,
  PickResult,
  ModelPickPayload,
  DumpSummary,
  DumpTranscript,
  SessionTranscribeResult,
} from '@shared/ipc-protocol';
import type {
  SessionFinalizeArgs,
  SessionFinalizeResult,
  SessionFinalizeFromDumpArgs,
} from '../main/sidecar/ipc/session-finalize';

contextBridge.exposeInMainWorld('lisna', {
  startRecording: (source: 'mic' | 'system') => ipcRenderer.invoke(CHANNELS.startRecording, { source }),
  stopRecording: () => ipcRenderer.invoke(CHANNELS.stopRecording),
  sendChunk: (chunk: ChunkPayload) => ipcRenderer.invoke(CHANNELS.chunk, chunk),
  capabilities: () => ipcRenderer.invoke(CHANNELS.capabilities),

  // --- Step 4 additions ---

  startSession: ({ language }: SessionStartPayload): Promise<void> =>
    ipcRenderer.invoke(CHANNELS.sessionStart, { language }),

  /** Drop the stopped session without generating a note (discard route). */
  discardSession: (): Promise<void> => ipcRenderer.invoke(CHANNELS.sessionDiscard),

  /**
   * V2 family-routed note generation — the sole finalize path for structured
   * notes (the legacy `session/stop` markdown path was removed in STT Phase 2).
   * Per Plan 3 Task 10 + spec §9.
   *
   * The main process loads the LLM lazily inside `getCurrentSession`
   * (first call may take ~30 s on cold cache; subsequent calls within
   * the same session are immediate). Result includes the orchestrator's
   * structured note so the renderer can render without a second IPC
   * round-trip.
   */
  finalize: (args: SessionFinalizeArgs): Promise<SessionFinalizeResult> =>
    ipcRenderer.invoke(CHANNELS.sessionFinalize, args),

  /**
   * Raw-transcript output mode — transcribe the whole captured WAV and return
   * the raw segments with NO note generation (no LLM load). The post-Stop
   * picker's 文字起こし choice routes here. Rejects with the same guards as
   * `finalize` (NO_ACTIVE_SESSION / WAV_MISSING / EMPTY_RECORDING /
   * FINALIZE_IN_FLIGHT — the in-flight flag is shared with note finalize).
   */
  transcribeOnly: (): Promise<SessionTranscribeResult> =>
    ipcRenderer.invoke(CHANNELS.sessionTranscribe),

  // --- F2 history viewer ---

  /** Newest-first summaries of past finalize dumps (#113 tree). */
  listDumps: (): Promise<DumpSummary[]> =>
    ipcRenderer.invoke(CHANNELS.sessionListDumps),

  /** Full transcript of one dump. Throws INVALID_DUMP_ID / DUMP_NOT_FOUND / DUMP_UNREADABLE. */
  loadDump: (id: string): Promise<DumpTranscript> =>
    ipcRenderer.invoke(CHANNELS.sessionLoadDump, { id }),

  /**
   * Regenerate a note from a dump transcript. Same result shape as
   * `finalize`. Rejects with SESSION_ACTIVE while recording, and with
   * FINALIZE_IN_FLIGHT when another finalize is running. Can also reject
   * with the dump-context guard codes — see getDumpSession in
   * session-finalize.ts for the full set.
   */
  finalizeFromDump: (args: SessionFinalizeFromDumpArgs): Promise<SessionFinalizeResult> =>
    ipcRenderer.invoke(CHANNELS.sessionFinalizeFromDump, args),

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
   * Subscribe to real finalize progress (chunk N/M, attempt, phase) pushed
   * while `finalize` / `finalizeFromDump` runs. Returns an unsubscribe
   * function — same useEffect-cleanup contract as onSessionError.
   */
  onFinalizeProgress: (cb: (msg: FinalizeProgressPayload) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, msg: FinalizeProgressPayload) => cb(msg);
    ipcRenderer.on(CHANNELS.sessionFinalizeProgress, listener);
    return () => ipcRenderer.removeListener(CHANNELS.sessionFinalizeProgress, listener);
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

  /**
   * Save a pre-serialized text payload to a user-chosen file via the native
   * save dialog (note/transcript Export button). `defaultName` seeds the dialog
   * filename (extension implies format). Resolves `{ok:false, canceled:true}`
   * when the user dismisses the dialog.
   */
  exportFile: (args: { content: string; defaultName: string }): Promise<{ ok: boolean; canceled: boolean; path?: string }> =>
    ipcRenderer.invoke(CHANNELS.exportFile, args),

  // --- Phase M Task 70 — sign-in handshake bridges ---

  /**
   * Fire-and-forget: opens `lisna.jp/signin?source=app&app_callback=…` in the
   * default browser. Resolves once shell.openExternal returns; the actual
   * sign-in completes out-of-band and lands via `auth/signed-in`.
   */
  signIn: (): Promise<void> => ipcRenderer.invoke(CHANNELS.authSignIn),

  /**
   * Boot-time check: returns `{ signedIn:true }` when a device token is
   * present in Keychain, `{ signedIn:false }` otherwise. Used by App.tsx's
   * auth gate to decide between SignInView and the authenticated shell.
   */
  getAuthState: (): Promise<AuthState> =>
    ipcRenderer.invoke(CHANNELS.authGetState),

  /**
   * Subscribe to the post-redeem `auth/signed-in` broadcast. Returns an
   * unsubscribe function — the auth gate's useEffect MUST call it on cleanup
   * to avoid duplicate listeners across Strict Mode double-mounts. Matches
   * the onSessionError unsubscriber convention.
   */
  onSignedIn: (cb: () => void): (() => void) => {
    const listener = () => cb();
    ipcRenderer.on(CHANNELS.authSignedIn, listener);
    return () => ipcRenderer.removeListener(CHANNELS.authSignedIn, listener);
  },
});

declare global {
  interface Window {
    lisna: {
      startRecording(source: 'mic' | 'system'): Promise<{ ok: boolean; source: string }>;
      stopRecording(): Promise<{ ok: boolean }>;
      sendChunk(chunk: ChunkPayload): Promise<{ ok: boolean }>;
      capabilities(): Promise<Capabilities>;
      startSession(payload: SessionStartPayload): Promise<void>;
      /** Drop the stopped session without generating a note (discard route). */
      discardSession(): Promise<void>;
      finalize(args: SessionFinalizeArgs): Promise<SessionFinalizeResult>;
      transcribeOnly(): Promise<SessionTranscribeResult>;
      listDumps(): Promise<DumpSummary[]>;
      loadDump(id: string): Promise<DumpTranscript>;
      finalizeFromDump(args: SessionFinalizeFromDumpArgs): Promise<SessionFinalizeResult>;
      onSessionError(cb: (msg: SessionErrorPayload) => void): () => void;
      onFinalizeProgress(cb: (msg: FinalizeProgressPayload) => void): () => void;
      restartApp(): Promise<void>;
      getModelStatus(): Promise<ModelStatus>;
      pickModel(slot: ModelSlot): Promise<PickResult>;
      openExternal(url: string): Promise<void>;
      exportFile(args: { content: string; defaultName: string }): Promise<{ ok: boolean; canceled: boolean; path?: string }>;
      signIn(): Promise<void>;
      getAuthState(): Promise<AuthState>;
      onSignedIn(cb: () => void): () => void;
    };
  }
}
