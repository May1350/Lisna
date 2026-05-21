import os from 'node:os';
import { app, ipcMain, shell, type BrowserWindow } from 'electron';
import type {
  AuthState,
  Capabilities,
  ChunkPayload,
  ChunkResultPayload,
  SessionStartPayload,
  SessionPhase,
} from '@shared/ipc-protocol';
import type { Note } from '@shared/types';
import type { SidecarSupervisor } from './sidecar/supervisor';
import { SessionOrchestrator } from './sidecar/orchestrator';
import { WhisperCppSTT } from './engines/whisper-cpp-stt';
import { LlamaCppLLM } from './engines/llama-cpp-llm';
import { isMacAudioLoopbackSupported } from './platform/hardware-check';
import { log, sessionLog } from './log';
import { loadToken } from './auth/keychain';

export const CHANNELS = {
  startRecording: 'recording/start',
  stopRecording: 'recording/stop',
  /** renderer → main: a finalized PCM chunk for downstream STT */
  chunk: 'recording/chunk',
  /** main → renderer: STT result segments pushed back after each chunk */
  onChunk: 'recording/chunk-result',
  /** renderer → main: query platform capabilities on mount (sync, cheap) */
  capabilities: 'platform/capabilities',
  /** renderer → main: create SessionOrchestrator + load STT */
  sessionStart: 'session/start',
  /** renderer → main: orch.stop() returning Note */
  sessionStop: 'session/stop',
  /** main → renderer: phase indicator during long awaits */
  sessionPhase: 'session/phase',
  /** main → renderer: sidecar crashed mid-session */
  sessionError: 'session/error',
  /** renderer → main: app.relaunch() + app.quit() for §3.6 give-up recovery */
  lifecycleRestart: 'lifecycle/restart',
  /** renderer → main: query current ModelStatus on App mount */
  modelStatus: 'models/status',
  /** renderer → main: native file dialog + magic-byte validate + atomic
   *  save for one slot. Handler awaits the disk write before returning,
   *  so PickResult.status reflects committed state (spec §5.1 step 7). */
  modelPick: 'models/pick',
  /** renderer → main: launch external URL via shell.openExternal.
   *  Guarded https:// allow-list; rejects all other schemes. */
  shellOpenExternal: 'shell/open-external',
  /** renderer → main: open the web `/signin` flow with `source=app` and the
   *  `lisna://callback` URI in the user's default browser. Fire-and-forget. */
  authSignIn: 'auth/sign-in',
  /** renderer → main: query whether a device token is present in Keychain. */
  authGetState: 'auth/get-state',
  /** main → renderer: broadcast after `handleAuthCallback` successfully
   *  redeems an exchange code and stores the device token. */
  authSignedIn: 'auth/signed-in',
} as const;

export interface IpcDeps {
  /** Lazily-resolved BrowserWindow ref. Survives darwin window re-create. */
  getMainWindow: () => BrowserWindow | undefined;
  supervisor: SidecarSupervisor;
  /**
   * Lazy getter for the currently-resolved model paths. Returns `null` while
   * `resolveResult.kind === 'needs-setup'`. Must be a getter (not static
   * captured paths) so the post-pick `models/pick` save propagates here:
   * registerIpc is called ONCE at boot, but the user can transition
   * needs-setup → ready via the picker after this point. A static capture
   * would freeze the boot-time `undefined` values and `session/start` would
   * forever reject with MODELS_NOT_CONFIGURED even after a successful pick.
   */
  getModelPaths: () => { sttPath: string; llmPath: string } | null;
}

// --- Module-level session FSM state ---
//
// `current` and `recording` are mutated SYNCHRONOUSLY around `await` points.
// JS single-threaded execution between awaits is the synchronization primitive
// (no mutex needed). The sidecar's NDJSON FIFO serializes sidecar ops; this
// state machine prevents only the orchestrator-instance-overlap race.
//
// FSM:
//   idle (current=null, recording=false)
//     → starting (current=orch, recording=false, session/start awaiting orch.start)
//     → ready (current=orch, recording=true)
//     → finalizing (current=orch, recording=false, session/stop awaiting orch.stop)
//     → idle
//   Crash edge: handleSidecarExit() clears state + pushes session/error from any
//   non-idle state.
//   Permanent give-up edge: handleSidecarGiveUp() additionally sets _sidecarGaveUp,
//   which short-circuits future session/start calls until lifecycle/restart fires.
let current: SessionOrchestrator | null = null;
let recording = false;
let _appQuitting = false;
// True after supervisor.onCrash fires (2 consecutive sidecar crashes; respawn
// abandoned). Stays true until lifecycle/restart relaunches the app. Gates
// session/start ahead of the sidecar-getClient check so the user sees a
// "restart required" error instead of repeated SIDECAR_DOWN bounces.
let _sidecarGaveUp = false;
// True while session/start or session/stop handler body is awaiting (not for
// recording/chunk). Read by handleSidecarExit to suppress the duplicate
// session/error push when the in-flight handler's IPC rejection will surface
// the error to the renderer.
let _sessionHandlerInFlight = false;

// Captured by registerIpc — null only until first registerIpc call. handleSidecarExit
// is invoked by main/index.ts via supervisor.onExit; supervisor.start() runs in
// whenReady before registerIpc, but in practice no sidecar exit can fire before
// registerIpc (waitForReady happens before createWindow → registerIpc). The
// optional-chain guards against any future reordering.
let _safeSend: ((channel: string, payload: unknown) => void) | null = null;

/**
 * Exported for unit testing — the chunk handler exposed as a pure function. The
 * production code uses the inline IPC handler registered in registerIpc; tests
 * can also drive this directly with a fake IpcMainInvokeEvent.
 *
 * (Step 4 note: the old handleChunk-with-deps signature is gone; the FSM in
 * module-level state replaces dependency injection at the per-chunk level.)
 */
export async function handleChunk(
  event: { sender: { send: (channel: string, payload: ChunkResultPayload) => void } },
  payload: ChunkPayload,
): Promise<{ ok: boolean }> {
  if (!recording || !current) return { ok: true };  // silent no-op
  const orch = current;
  try {
    const segs = await orch.onChunk(payload.samples);
    event.sender.send(CHANNELS.onChunk, {
      index: payload.index,
      segments: segs,
      startMs: payload.startMs,
    });
  } catch (err) {
    // One failed chunk must not break the session — log, allow next chunk.
    // Index is shape-safe (a small integer); error message may include
    // sidecar diagnostic text but not user transcript content.
    log.error('[stt] chunk transcribe error', payload.index, err);
  }
  return { ok: true };
}

export function registerIpc(deps: IpcDeps) {
  function safeSend(channel: string, payload: unknown) {
    const w = deps.getMainWindow();
    if (!w || w.isDestroyed()) return;
    w.webContents.send(channel, payload);
  }
  _safeSend = safeSend;

  ipcMain.handle(CHANNELS.sessionStart, async (_e, { language }: SessionStartPayload) => {
    if (_sidecarGaveUp) throw new Error('SIDECAR_GAVE_UP');
    if (current !== null) throw new Error('SESSION_ACTIVE');
    if (language !== 'ja') throw new Error('UNSUPPORTED_LANGUAGE');  // v2.0 JA-only
    const paths = deps.getModelPaths();
    if (!paths) throw new Error('MODELS_NOT_CONFIGURED');
    const client = deps.supervisor.getClient();
    if (!client) throw new Error('SIDECAR_DOWN');
    // Fresh adapters per session — survives sidecar respawn without holding
    // stale client refs. WhisperCppSTT / LlamaCppLLM constructors are pure
    // (just stash this.client), so per-session construction is cheap.
    const stt = new WhisperCppSTT(client);
    const llm = new LlamaCppLLM(client);
    const orch = new SessionOrchestrator({
      stt, llm,
      sttModelPath: paths.sttPath,
      llmModelPath: paths.llmPath,
      language,
    });
    current = orch;  // claim BEFORE await — concurrent start re-entry blocked synchronously
    _sessionHandlerInFlight = true;
    // Step 5 §4.2 — session-boundary breadcrumb. Emit at the FIRST committed
    // point of start (after all rejection gates pass) so log readers can match
    // start↔stop pairs cleanly without spurious "start lang=ja" entries from
    // rejected attempts.
    sessionLog.start(language);
    const sttLoadStartMs = Date.now();
    try {
      safeSend(CHANNELS.sessionPhase, { phase: 'stt-loading' });
      await orch.start();
      sessionLog.phase('stt-load', Date.now() - sttLoadStartMs);
      recording = true;
    } catch (err) {
      const code = err instanceof Error ? err.message : String(err);
      sessionLog.error(code);
      log.error('[session] start failed', err);
      current = null;
      throw err;
    } finally {
      _sessionHandlerInFlight = false;
    }
  });

  ipcMain.handle(CHANNELS.startRecording, async (_e, opts: { source: 'mic' | 'system' }) => {
    // Audio plumbing stub — kept unchanged for v2.0. Phase 4 fills in mic-permission gate.
    return { ok: true, source: opts.source };
  });
  ipcMain.handle(CHANNELS.stopRecording, async () => ({ ok: true }));
  ipcMain.handle(CHANNELS.chunk, (e, payload: ChunkPayload) => handleChunk(e, payload));
  ipcMain.handle(CHANNELS.capabilities, (): Capabilities => ({
    systemAudio: isMacAudioLoopbackSupported(),
    platform: process.platform,
    osRelease: os.release(),
  }));

  ipcMain.handle(CHANNELS.lifecycleRestart, async () => {
    // Step 5 §3.6 — give-up recovery. Restart the Electron app so the OS
    // re-spawns a fresh sidecar process from scratch and `_sidecarGaveUp` /
    // ipc.ts module state are wiped (process exit clears them implicitly).
    //
    // CRITICAL ORDER: relaunch BEFORE quit. `app.quit()` dispatches the
    // before-quit hook synchronously; if quit ran first, the scheduled
    // relaunch would not be registered yet and the OS would just close us.
    app.relaunch();
    app.quit();
  });

  ipcMain.handle(CHANNELS.shellOpenExternal, async (_e, payload: { url: string }) => {
    // Defense-in-depth: caller already gates Discord URL via
    // isDiscordUrlConfigured(), but the bridge is a public surface — only
    // https:// links are honored. Anything else is logged and dropped.
    if (!/^https:\/\//.test(payload.url)) {
      log.warn('[shell] rejected non-https openExternal', payload.url);
      return;
    }
    await shell.openExternal(payload.url);
  });

  // Phase M Task 70 — open the web sign-in flow in the user's default
  // browser. `source=app` makes the web `/signin` page redirect to
  // `/api/auth/exchange-code/issue` after sign-in (instead of `/dashboard`),
  // which 302s back to `lisna://callback?code=…` for redemption. The web
  // side handshake is the Phase K contract; do not alter the query params.
  ipcMain.handle(CHANNELS.authSignIn, async () => {
    const webUrl = process.env.LISNA_WEB_URL ?? 'https://lisna.jp';
    const callback = encodeURIComponent('lisna://callback');
    await shell.openExternal(`${webUrl}/signin?source=app&app_callback=${callback}`);
  });

  // Phase M Task 70 — boot-time check. The renderer's gate calls this on
  // mount to decide between SignInView and AuthenticatedApp. `loadToken`
  // returns `null` when the Keychain entry is missing; presence is the
  // sole signedIn signal (token validity is verified lazily on first
  // app-API call, not here).
  ipcMain.handle(CHANNELS.authGetState, async (): Promise<AuthState> => ({
    signedIn: (await loadToken()) !== null,
  }));

  ipcMain.handle(CHANNELS.sessionStop, async (): Promise<Note> => {
    if (current === null) throw new Error('NO_ACTIVE_SESSION');
    if (!recording) throw new Error('SESSION_NOT_READY');  // start in flight
    const orch = current;
    recording = false;  // sync: post-stop chunks immediately no-op
    _sessionHandlerInFlight = true;
    // Step 5 §4.2 — phase timings. The orchestrator fires onPhase synchronously
    // BEFORE each of its three internal awaits (stt-unloading → llm-loading →
    // generating). We wrap that callback to (1) forward the safeSend (unchanged
    // renderer behavior) and (2) record the elapsed ms since the previous
    // phase entry, emitting a breadcrumb when the next one starts.
    let lastPhaseAt = Date.now();
    let lastPhase: SessionPhase | null = null;
    const onPhase = (phase: SessionPhase): void => {
      const now = Date.now();
      if (lastPhase !== null) sessionLog.phase(lastPhase, now - lastPhaseAt);
      lastPhase = phase;
      lastPhaseAt = now;
      safeSend(CHANNELS.sessionPhase, { phase });
    };
    try {
      const note = await orch.stop(onPhase);
      // Emit the timing for the final phase (`generating`) — orch.stop's
      // finally-block llm.unloadModel() doesn't get its own breadcrumb (the
      // 'stt-unloading' / 'llm-loading' / 'generating' set covers all observed
      // phases per Step 5 spec).
      if (lastPhase !== null) sessionLog.phase(lastPhase, Date.now() - lastPhaseAt);
      sessionLog.stop({ noteChars: note.markdown.length, segments: note.transcriptSegments.length });
      return note;
    } catch (err) {
      if (lastPhase !== null) sessionLog.phase(lastPhase, Date.now() - lastPhaseAt);
      if (_appQuitting) {
        sessionLog.error('APP_QUIT');
        throw new Error('APP_QUIT');
      }
      const code = err instanceof Error ? err.message : String(err);
      sessionLog.error(code);
      throw err;
    } finally {
      current = null;
      _sessionHandlerInFlight = false;
    }
  });
}

/**
 * Called by main/index.ts before-quit hook BEFORE supervisor.shutdown() SIGTERMs
 * the sidecar. session/stop's catch reads this to remap "sidecar process exited"
 * rejections to APP_QUIT, which the renderer suppresses (window is dying).
 */
export function setAppQuitting() {
  _appQuitting = true;
}

/**
 * Called by main/index.ts via supervisor.onExit on every unexpected sidecar exit.
 * Clears session state and pushes `session/error` to renderer.
 *
 * **Why the in-flight guard:** the supervisor's `proc.on('exit', handleExit)`
 * listener fires synchronously; SidecarClient's `rejectAllPending` schedules
 * pending rejections on the microtask queue. So when a sidecar crashes
 * mid-`session/start` or mid-`session/stop`, this function runs BEFORE the
 * in-flight handler's catch/finally completes — `current` is still non-null.
 * Without the guard, we'd push `session/error` AND the IPC handler would also
 * reject to the renderer → two transitions to error view. With the guard:
 * when a session handler is in-flight, the IPC rejection alone surfaces the
 * error and we suppress the push. State (`current`/`recording`) is still
 * cleared synchronously so the next session/start can proceed.
 *
 * Chunk handler crashes do NOT trigger a session handler — `recording/chunk`
 * swallows transcribe errors. So for chunk-in-flight + crash, the push fires
 * (which is correct — renderer has no other signal).
 */
export function handleSidecarExit() {
  if (!current && !recording) return;
  const wasHandlerInFlight = _sessionHandlerInFlight;
  current = null;
  recording = false;
  if (wasHandlerInFlight) return;  // IPC rejection handles renderer transition
  // Code-only payload — renderer maps it to JA copy via `toFriendlyJa`.
  // Previously this was an EN sentence which the substring matcher couldn't
  // resolve to any known code → user got the generic JA fallback. SIDECAR_DOWN
  // is the right code: the supervisor will respawn within 500ms; on success
  // the next session/start passes the SIDECAR_DOWN guard.
  _safeSend?.(CHANNELS.sessionError, { message: 'SIDECAR_DOWN' });
}

/**
 * Called by main/index.ts via supervisor.onCrash when the supervisor has given
 * up respawning (`maxConsecutiveFailures` reached). Different from
 * handleSidecarExit in three ways:
 *
 *   1. Sets `_sidecarGaveUp = true` so subsequent `session/start` IPC calls
 *      reject with `SIDECAR_GAVE_UP` (not the misleading `SIDECAR_DOWN`).
 *   2. Pushes `session/error` with `permanent: true` so the renderer shows
 *      a Restart Lisna button instead of Try Again.
 *   3. Pushes EVEN WHEN IDLE — unlike handleSidecarExit which silently no-ops
 *      from idle. Rationale: a user clicking Start while idle after a give-up
 *      would see the rejection mid-action; pre-emptively surface the state
 *      so the UI displays the restart prompt immediately.
 *
 * Ordering note: SidecarSupervisor.handleExit fires `onExit` FIRST then
 * `onCrash` on the give-up case. So handleSidecarExit will have already
 * cleared state and (in non-handler-in-flight cases) pushed the transient
 * "engine restarted" error. handleSidecarGiveUp's push happens after; the
 * renderer's App.tsx idempotency keeps the earlier error view but updates
 * via the new payload's `permanent: true` flag — see ErrorView §3.6 logic.
 */
export function handleSidecarGiveUp() {
  _sidecarGaveUp = true;
  current = null;
  recording = false;
  // Code-only payload like handleSidecarExit. ErrorView's `permanent` branch
  // forces the SIDECAR_GAVE_UP JA copy regardless of `message`, but emitting
  // the matching code keeps the contract uniform (App.tsx onError path with
  // its includes-check still sees a recognizable code if the IPC channel
  // ever lost the permanent flag in transit).
  _safeSend?.(CHANNELS.sessionError, {
    message: 'SIDECAR_GAVE_UP',
    permanent: true,
  });
}
