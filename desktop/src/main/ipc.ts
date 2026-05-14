import os from 'node:os';
import { ipcMain, type BrowserWindow } from 'electron';
import type {
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
} as const;

export interface IpcDeps {
  /** Lazily-resolved BrowserWindow ref. Survives darwin window re-create. */
  getMainWindow: () => BrowserWindow | undefined;
  supervisor: SidecarSupervisor;
  sttModelPath?: string;
  llmModelPath?: string;
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
let current: SessionOrchestrator | null = null;
let recording = false;
let _appQuitting = false;
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
    console.error('[stt] chunk transcribe error', payload.index, err);
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
    if (current !== null) throw new Error('SESSION_ACTIVE');
    if (language !== 'ja') throw new Error('UNSUPPORTED_LANGUAGE');  // v2.0 JA-only
    if (!deps.sttModelPath || !deps.llmModelPath) throw new Error('MODELS_NOT_CONFIGURED');
    const client = deps.supervisor.getClient();
    if (!client) throw new Error('SIDECAR_DOWN');
    // Fresh adapters per session — survives sidecar respawn without holding
    // stale client refs. WhisperCppSTT / LlamaCppLLM constructors are pure
    // (just stash this.client), so per-session construction is cheap.
    const stt = new WhisperCppSTT(client);
    const llm = new LlamaCppLLM(client);
    const orch = new SessionOrchestrator({
      stt, llm,
      sttModelPath: deps.sttModelPath,
      llmModelPath: deps.llmModelPath,
      language,
    });
    current = orch;  // claim BEFORE await — concurrent start re-entry blocked synchronously
    _sessionHandlerInFlight = true;
    try {
      safeSend(CHANNELS.sessionPhase, { phase: 'stt-loading' });
      await orch.start();
      recording = true;
    } catch (err) {
      console.error('[session] start failed', err);
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

  ipcMain.handle(CHANNELS.sessionStop, async (): Promise<Note> => {
    if (current === null) throw new Error('NO_ACTIVE_SESSION');
    if (!recording) throw new Error('SESSION_NOT_READY');  // start in flight
    const orch = current;
    recording = false;  // sync: post-stop chunks immediately no-op
    _sessionHandlerInFlight = true;
    try {
      return await orch.stop((phase: SessionPhase) => safeSend(CHANNELS.sessionPhase, { phase }));
    } catch (err) {
      if (_appQuitting) throw new Error('APP_QUIT');
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
  _safeSend?.(CHANNELS.sessionError, {
    message: 'Recording engine restarted. Please try again.',
  });
}
