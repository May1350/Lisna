import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { app, ipcMain, shell, dialog, type BrowserWindow } from 'electron';
import { WavWriter } from './audio-wav-writer';
import { buildInitialPrompt, parseGlossary } from '@shared/stt/glossary';
import type {
  AuthState,
  Capabilities,
  ChunkPayload,
  SessionStartPayload,
  SessionTranscribeResult,
} from '@shared/ipc-protocol';
import type { NoteLanguage } from '@shared/note-schema';
import type { TranscriptSegment } from '@shared/engine-interfaces';
import type { SidecarSupervisor } from './sidecar/supervisor';
import { SessionOrchestrator } from './sidecar/orchestrator';
import { makeGrammarSidecar } from './sidecar/grammar-call';
import type { GrammarCapableSidecar } from './sidecar/grammar-call';
import { makeRecoveringGrammarSidecar } from './sidecar/recovering-grammar-sidecar';
import { buildDumpSessionContext } from './dump-finalize-context';
import { listDumps, loadDumpTranscript } from './session-dump-reader';
import { WhisperCppSTT } from './engines/whisper-cpp-stt';
import { LlamaCppLLM } from './engines/llama-cpp-llm';
import { TIMEOUTS } from './sidecar/timeouts';
import { isMacAudioLoopbackSupported } from './platform/hardware-check';
import { log, redactPath, sessionLog } from './log';
import { loadToken } from './auth/keychain';
import { registerSessionFinalize } from './sidecar/ipc/session-finalize';
import { toFinalizeProgressPayload } from './sidecar/ipc/finalize-progress';
import { createSessionDump, type SessionDump } from './session-debug-dump';
import { languageCapabilities } from '@shared/language-capabilities';

export const CHANNELS = {
  startRecording: 'recording/start',
  stopRecording: 'recording/stop',
  /** renderer → main: a finalized PCM chunk for downstream STT */
  chunk: 'recording/chunk',
  /** renderer → main: query platform capabilities on mount (sync, cheap) */
  capabilities: 'platform/capabilities',
  /** renderer → main: create SessionOrchestrator + load STT */
  sessionStart: 'session/start',
  /** renderer → main: drop the stopped session WITHOUT generating a note.
   *  Clears the orchestrator + LLM-loaded cache so the next session/start
   *  isn't rejected with SESSION_ACTIVE. No-op when nothing is active. */
  sessionDiscard: 'session/discard',
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
  /** renderer → main: v2 finalize replacing session/stop (Task 10).
   *  Lecture branch dispatches finalizeLecture; other families throw
   *  FAMILY_NOT_IMPLEMENTED:<family>:<future-plan>. */
  sessionFinalize: 'session/finalize',
  /** renderer → main: F2 history viewer — list #113 dump summaries. */
  sessionListDumps: 'session/list-dumps',
  /** renderer → main: F2 — full transcript of one dump. */
  sessionLoadDump: 'session/load-dump',
  /** renderer → main: F2 — regenerate a note from a dump transcript.
   *  Registered in session-finalize.ts (SESSION_FINALIZE_FROM_DUMP_CHANNEL). */
  sessionFinalizeFromDump: 'session/finalize-from-dump',
  /** main → renderer: real chunk/attempt progress while a finalize (live or
   *  from-dump) runs. Derived 1:1 from orchestrator telemetry — see
   *  toFinalizeProgressPayload for the field-stripping contract. */
  sessionFinalizeProgress: 'session/finalize-progress',
  /** renderer → main: LLM-free whole-WAV raw transcript (no note). Reuses the
   *  finalize transcription + cache + dump, stops before the LLM load.
   *  Equals SESSION_TRANSCRIBE_CHANNEL in session-finalize.ts. */
  sessionTranscribe: 'session/transcribe',
  /** renderer → main: save a text payload to a user-chosen file via the native
   *  save dialog (the note/transcript Export button). Content is pre-serialized
   *  in the renderer; main only writes bytes. Returns {ok, canceled, path?}. */
  exportFile: 'file/export',
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
// Tracks the orchestrator instance whose LLM has been loaded for the v2
// session/finalize path. Spec §9 — IPC finalize needs an explicit unload-STT
// + load-LLM prep step (unlike orchestrator.stop(), which loads inline).
// When `current !== _llmLoadedForCurrent`, the next finalize call performs
// the load + caches; subsequent calls within the same session are no-ops.
// Reset everywhere `current` is reset (session end / sidecar exit / give-up).
let _llmLoadedForCurrent: SessionOrchestrator | null = null;
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
// Debug dump for the finalize in flight (2026-06-11, coverage-collapse
// diagnosis). Created in getCurrentSession (one dir per finalize invocation,
// retries included), finalized + cleared in onSessionSettled. Null when the
// dump is disabled (LISNA_DISABLE_SESSION_DUMP=1) or unavailable.
let _activeDump: SessionDump | null = null;
// Always-on raw-audio capture (STT Phase 2 — WAV is the SOLE transcript
// source for whole-file re-transcription at finalize). Audio is on-device
// only, retained in userData/audio-captures/, and user-deletable (spec §13).
// Opened at session/start, closed at every session-end path (stop, discard,
// crash, give-up, write-failure). Null when LISNA_DISABLE_AUDIO_SAVE=1
// (test kill-switch only) or when the writer failed to open.
let _audioWriter: WavWriter | null = null;

// ── Session-scoped sidecar lifecycle (2026-06-10, founder reboot incident) ──
// "Runs only when in use": the sidecar previously lived for the app's whole
// lifetime, and after a finalize the 3 GB LLM stayed resident forever. On an
// 8 GB machine that meant permanent swap pressure even while idle. Policy:
//   - any session settle (success OR failure) → unload the LLM immediately
//   - IDLE_STOP_MS with no session → kill the sidecar process entirely
//   - next session/start lazily respawns (+~0.5 s) and reloads STT (~0.8 s)
const IDLE_STOP_MS = 5 * 60_000;
let _idleStopTimer: NodeJS.Timeout | null = null;
let _depsRef: IpcDeps | null = null;

function armIdleStop(): void {
  if (_idleStopTimer) clearTimeout(_idleStopTimer);
  _idleStopTimer = setTimeout(() => {
    _idleStopTimer = null;
    if (current !== null || recording) return; // session started meanwhile
    const sup = _depsRef?.supervisor;
    if (!sup?.getClient()) return; // already gone
    sessionLog.idleStop();
    void sup.stop();
  }, IDLE_STOP_MS);
}

/** Respawn gate for the supervisor: a dead sidecar only matters when a
 *  session is actually using it. Exported for index.ts wiring. */
export function isSessionInFlight(): boolean {
  return current !== null || recording;
}

/** Close and null the audio writer, best-effort. Called at every session-end
 *  path (stop, discard, crash, give-up). Idempotent — WavWriter.close() is a
 *  no-op after the first call, and the null-guard here means extra calls cost
 *  nothing. */
function closeAudioWriter(): void {
  try { _audioWriter?.close(); } catch { /* best-effort */ } finally { _audioWriter = null; }
}

function cancelIdleStop(): void {
  if (_idleStopTimer) {
    clearTimeout(_idleStopTimer);
    _idleStopTimer = null;
  }
}

/** Free the 3 GB LLM as soon as a session settles. Fire-and-forget — an
 *  unload race with a dying sidecar is harmless (process exit frees it). */
function unloadLlmIdle(): void {
  const client = _depsRef?.supervisor.getClient();
  if (!client) return;
  const t0 = Date.now();
  new LlamaCppLLM(client).unloadModel()
    .then(() => sessionLog.phase('llm-unload-idle', Date.now() - t0))
    .catch(() => { /* sidecar gone or model not loaded — equally unloaded */ });
}

// Captured by registerIpc — null only until first registerIpc call. handleSidecarExit
// is invoked by main/index.ts via supervisor.onExit; supervisor.start() runs in
// whenReady before registerIpc, but in practice no sidecar exit can fire before
// registerIpc (waitForReady happens before createWindow → registerIpc). The
// optional-chain guards against any future reordering.
let _safeSend: ((channel: string, payload: unknown) => void) | null = null;

type SidecarClientLike = NonNullable<ReturnType<SidecarSupervisor['getClient']>>;

/** Where finalize reads + the viewer lists dumps. Single source for the path. */
function sessionsBaseDir(): string {
  return path.join(app.getPath('userData'), 'sessions');
}

/**
 * STT Phase 1 proper-noun bias. Reads an optional `<userData>/glossary.json`
 * (a JSON array of term strings) and builds a Whisper initial_prompt from it.
 * Absent / unreadable / malformed → '' (no bias). Founder-editable without a
 * rebuild; holds only domain terms (no PII).
 */
function loadGlossaryInitialPrompt(): string {
  try {
    const file = path.join(app.getPath('userData'), 'glossary.json');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
    return buildInitialPrompt(parseGlossary(raw));
  } catch {
    return '';  // ENOENT (the common case) or malformed JSON — no bias.
  }
}

/** Private stall sentinel (H1): a single transcribe attempt saw no `sttProgress`
 *  heartbeat for STT_TRANSCRIBE_NO_PROGRESS_MS. Thrown by sttPassWithWatchdog,
 *  caught by the orchestrator to drive the restart→retry. Never surfaced to the
 *  renderer — the terminal failure is `STT_STALLED`. */
const STT_NO_PROGRESS = 'STT_NO_PROGRESS';

/**
 * ONE whole-WAV transcribe attempt with a NO-PROGRESS watchdog (H1).
 *
 * Loads STT WITH the session language (load-time param drives `filterSegments`;
 * `transcribeFile` itself is language-agnostic). The load is NOT watched — a cold
 * STT load is slow and emits no `sttProgress`, so arming during it would false-
 * fire. Once load completes the watchdog arms: it expires after
 * STT_TRANSCRIBE_NO_PROGRESS_MS of silence and is reset on every forwarded
 * `sttProgress`. No wall-clock cap — a steadily-progressing 84-min lecture stays
 * alive indefinitely; only a wedged sidecar (single-threaded `whisper_full`, no
 * cooperative abort) trips it.
 *
 * `forwardPct` forwards each heartbeat as a `transcribe-progress` event (F1).
 *
 * Cleanup contract for the 8 GB floor:
 *  - success / real transcribeFile error → STT is gracefully `unloadModel()`-ed
 *    in `finally` (client is healthy).
 *  - STALL → the client is WEDGED; `unloadModel()` would queue behind the
 *    doomed transcribeFile FOREVER (unload is sent with timeoutMs:Infinity), so
 *    we do NOT await it. The orchestrator's `supervisor.restart()` SIGKILL frees
 *    the STT RAM instead. We throw the STT_NO_PROGRESS sentinel.
 *
 * The abandoned attempt's `transcribeFile` promise is given a no-op `.catch` so
 * that when the old process is SIGKILLed (rejecting all pending sends) it does
 * not surface as an unhandledRejection.
 */
async function sttPassWithWatchdog(
  client: SidecarClientLike,
  sttPath: string,
  language: NoteLanguage,
  wavPath: string,
  forwardPct: (pct: number) => void,
): Promise<TranscriptSegment[]> {
  const stt = new WhisperCppSTT(client);
  await stt.loadModel(sttPath, language);

  let stalled = false;
  let timer: NodeJS.Timeout | null = null;
  let onStall!: () => void;
  const stallPromise = new Promise<never>((_resolve, reject) => {
    onStall = () => {
      stalled = true;
      reject(new Error(STT_NO_PROGRESS));
    };
  });
  const arm = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(onStall, TIMEOUTS.STT_TRANSCRIBE_NO_PROGRESS_MS);
  };
  const unsub = client.onEvent((e) => {
    if (e.type === 'sttProgress') {
      forwardPct(e.pct);
      arm(); // heartbeat resets the no-progress window
    }
  });

  arm(); // transcribeFile is about to start (load done) — arm now
  const ip = loadGlossaryInitialPrompt();
  const tf = stt.transcribeFile(wavPath, ip ? { initialPrompt: ip } : undefined);
  // Prevent an unhandledRejection from the abandoned promise on a stall: after
  // supervisor.restart() SIGKILLs the wedged process, SidecarClient rejects all
  // pending sends → this `tf` rejects with "sidecar process exited" later.
  tf.catch(() => { /* abandoned-on-stall — swallow the post-SIGKILL rejection */ });
  try {
    return await Promise.race([tf, stallPromise]);
  } finally {
    if (timer) clearTimeout(timer);
    unsub();
    // Graceful unload ONLY when the client is healthy. On a stall the client is
    // wedged — awaiting unloadModel (timeoutMs:Infinity) would hang; restart
    // frees the RAM instead.
    if (!stalled) {
      await stt.unloadModel().catch(() => {
        // Best-effort: a failed unload (sidecar gone / model not loaded) still
        // leaves STT out of resident memory. Proceeding is safe.
      });
    }
  }
}

/**
 * Whole-WAV transcribe with finalize-progress events (F1) + the H1 stall
 * watchdog & single-retry recovery. Used by BOTH the note path
 * (getCurrentSession step B) and the transcript path (getTranscript).
 *
 * F1: emit `transcribe-start` once, forward each sidecar `sttProgress` as
 * `transcribe-progress`, emit `transcribe-done` even on failure so the renderer
 * progress UI never wedges. The subscription is scoped to a single attempt
 * (inside sttPassWithWatchdog) so a stray late event cannot leak onto the channel.
 *
 * H1 recovery: attempt 0 runs on the current `client`. On a no-progress stall the
 * sidecar PROCESS is restarted (SIGKILL + fresh spawn → frees the wedged STT
 * RAM), we wait for ready, and attempt 1 re-issues transcribeFile ONCE on the
 * fresh client (which reloads STT). A SECOND stall restarts once more for cleanup
 * (so the next op meets a healthy sidecar, not a wedged one) and throws
 * `STT_STALLED`. The LLM is NEVER loaded/reloaded here — the 8 GB floor forbids
 * STT+LLM co-resident, which is why this does NOT reuse makeRecoveringSidecarFor
 * (that reloads the LLM). A real transcribeFile error (not a stall) propagates
 * unchanged after one healthy graceful unload.
 *
 * _safeSend is null only before registerIpc (never in production at this call
 * site); the optional-chain matches every other emit here.
 */
async function transcribeWithProgress(
  client: SidecarClientLike,
  sttPath: string,
  language: NoteLanguage,
  wavPath: string,
): Promise<TranscriptSegment[]> {
  const forwardPct = (pct: number): void =>
    _safeSend?.(CHANNELS.sessionFinalizeProgress, { kind: 'transcribe-progress', pct });
  _safeSend?.(CHANNELS.sessionFinalizeProgress, { kind: 'transcribe-start' });
  try {
    // Attempt 0 — current client.
    try {
      return await sttPassWithWatchdog(client, sttPath, language, wavPath, forwardPct);
    } catch (e) {
      if (!(e instanceof Error) || e.message !== STT_NO_PROGRESS) throw e; // real error
    }
    // Stalled — restart the sidecar PROCESS (frees the wedged STT RAM) and retry once.
    log.warn('[finalize] STT transcribe stalled (no progress) — restarting sidecar + retrying STT (no LLM)');
    // `!` is safe: transcribeWithProgress is only reached via a finalize/transcribe
    // handler that already resolved a client from _depsRef.supervisor.
    const fresh = await _depsRef!.supervisor.restart();
    await fresh.waitForReady(5000);
    try {
      return await sttPassWithWatchdog(fresh, sttPath, language, wavPath, forwardPct);
    } catch (e) {
      if (!(e instanceof Error) || e.message !== STT_NO_PROGRESS) throw e; // real error on retry
    }
    // Second stall — give up. Restart ONCE more so the next op (e.g. a user
    // retry) hits a healthy sidecar instead of the second wedged process; this
    // cleanup must not mask the STT_STALLED failure if it itself errors.
    try {
      await _depsRef!.supervisor.restart();
    } catch (e) {
      log.warn('[finalize] post-stall cleanup restart failed (non-fatal)', e);
    }
    throw new Error('STT_STALLED');
  } finally {
    _safeSend?.(CHANNELS.sessionFinalizeProgress, { kind: 'transcribe-done' });
  }
}

/**
 * Spec §9 finalize prep, shared by the live path (getCurrentSession) and the
 * from-dump path: unload STT (idempotent) → load LLM, with the phase
 * breadcrumbs the founder-visible main.log timing decomposition relies on.
 */
async function loadLlmForFinalize(client: SidecarClientLike, llmPath: string): Promise<void> {
  const stt = new WhisperCppSTT(client);
  const llm = new LlamaCppLLM(client);
  const sttT0 = Date.now();
  await stt.unloadModel().catch(() => {
    // STT may not have been loaded (no recording happened, or already
    // unloaded by a prior finalize). Either way, proceed to LLM load.
  });
  sessionLog.phase('stt-unload-finalize', Date.now() - sttT0);
  const llmT0 = Date.now();
  await llm.loadModel(llmPath);
  sessionLog.phase('llm-load-finalize', Date.now() - llmT0);
}

/**
 * Wedged-retry recovery wrapper (2026-06-10 RCA in recovering-grammar-sidecar
 * .ts), shared by live + from-dump finalize paths. Resolves the client LAZILY
 * per generate call; on a no-progress stall restarts the sidecar + reloads
 * the LLM so fresh-seed retries hit a live process.
 */
function makeRecoveringSidecarFor(llmPath: string): GrammarCapableSidecar {
  return makeRecoveringGrammarSidecar({
    getSidecar: () => {
      const c = _depsRef?.supervisor.getClient();
      return c ? makeGrammarSidecar(c) : null;
    },
    recover: async () => {
      log.warn('[finalize] generate stalled (no progress) — restarting sidecar + reloading LLM');
      const t0 = Date.now();
      try {
        // `!` is safe: recover is only reachable via a sidecar handed out AFTER
        // registerIpc set _depsRef; getSidecar's `?.` handles the pre-registerIpc
        // construction window (never reached in production).
        const fresh = await _depsRef!.supervisor.restart();
        await fresh.waitForReady(5000);
        await new LlamaCppLLM(fresh).loadModel(llmPath);
        sessionLog.phase('llm-reload-recovery', Date.now() - t0);
      } catch (e) {
        // Force the next finalize to re-run the full
        // unload-STT → load-LLM prep instead of trusting the cache.
        _llmLoadedForCurrent = null;
        throw e;
      }
    },
  });
}

/**
 * Exported for unit testing — the chunk handler exposed as a pure function. The
 * production code uses the inline IPC handler registered in registerIpc; tests
 * can also drive this directly. Per-chunk it only drives the orchestrator's WAV
 * side-channel (onAudioChunk); no STT results are sent back to the renderer
 * (whole-file STT happens at finalize — STT Phase 2).
 *
 * (Step 4 note: the old handleChunk-with-deps signature is gone; the FSM in
 * module-level state replaces dependency injection at the per-chunk level.)
 */
export async function handleChunk(payload: ChunkPayload): Promise<{ ok: boolean }> {
  if (!recording || !current) return { ok: true };  // silent no-op
  const orch = current;
  try {
    // Whole-file STT happens at finalize (STT Phase 2). Per-chunk we only
    // drive the orchestrator's WAV side-channel (onAudioChunk) — no live
    // captions are pushed to the renderer anymore.
    await orch.onChunk(payload.samples, payload.startMs / 1000);
  } catch (err) {
    // One failed chunk must not break the session — log, allow next chunk.
    log.error('[stt] chunk handler error', payload.index, err);
  }
  return { ok: true };
}

export function registerIpc(deps: IpcDeps) {
  _depsRef = deps;
  function safeSend(channel: string, payload: unknown) {
    const w = deps.getMainWindow();
    if (!w || w.isDestroyed()) return;
    w.webContents.send(channel, payload);
  }
  _safeSend = safeSend;

  // ── session/finalize: v2 family-routed note generation (Task 10) ──────────
  registerSessionFinalize({
    getCurrentSession: async () => {
      if (!current) return null;
      const paths = deps.getModelPaths();
      const client = deps.supervisor.getClient();
      if (!paths || !client) return null;
      const orch = current;  // stable ref held across the awaits below

      // (A) Debug dump (2026-06-11): one dir per finalize invocation under
      // <userData>/sessions/. Created FIRST so even a transcription / LLM-load
      // failure leaves a result.json on disk — onSessionSettled(ok:false)
      // writes the error to this same handle. The 13-min coverage-collapse
      // incident was undiagnosable because nothing ever persisted. app.getPath
      // is guarded: a harness without it just runs the finalize undumped.
      try {
        _activeDump = createSessionDump({
          baseDir: sessionsBaseDir(),
        });
      } catch {
        _activeDump = null;
      }
      if (_activeDump) log.info('[finalize:dump]', redactPath(_activeDump.dir));

      // (B) STT Phase 2 (Task C3) — transcribe the whole captured WAV. Cached
      // on the ORCHESTRATOR INSTANCE (via exposedSegments / setFinalizeSegments)
      // so a note-gen retry — which nulls _llmLoadedForCurrent and idle-unloads
      // the LLM (P0-3 + onSessionSettled) — does NOT re-run the expensive
      // whole-file pass on a long recording. Runs only while no transcript is
      // held. This cache is INDEPENDENT of the LLM cache in (E): a retry skips
      // (B) but re-runs (E). Do NOT collapse them into one gate.
      if (orch.exposedSegments.length === 0) {
        const wavPath = orch.wavPath;
        if (!wavPath || !fs.existsSync(wavPath)) throw new Error('WAV_MISSING');
        const t0 = Date.now();
        const segs = await transcribeWithProgress(
          client,
          paths.sttPath,
          orch.language as NoteLanguage,
          wavPath,
        );
        orch.setFinalizeSegments(segs);
        sessionLog.phase('stt-transcribe-finalize', Date.now() - t0);
      }

      // (C) Empty guard — a silent / empty recording yields no usable
      // transcript. Throw before loading the LLM (the 3 GB load is wasted on a
      // no-op generate). The throw rides the same error machinery as (B).
      if (orch.exposedSegments.length === 0) throw new Error('EMPTY_RECORDING');

      // (C2) RE-RESOLVE the live client after transcribe. The H1 stall watchdog
      // in step (B) may have restarted the sidecar PROCESS (SIGKILL + fresh
      // spawn) to recover from a wedged transcribe — in which case the `client`
      // captured before (B) now points at the DEAD process. Step (E)'s
      // loadLlmForFinalize sends unload/load with timeoutMs:Infinity; on a dead
      // client SidecarClient.rejectAllPending already fired on proc.exit and
      // won't fire again, so those sends NEVER settle → the note finalize hangs
      // forever (force-quit only). getClient() returns the SAME client on the
      // no-restart path (harmless) and the FRESH one after recovery. (Step (F)'s
      // makeRecoveringSidecarFor already resolves lazily via _depsRef, so it
      // needs no fix here.)
      const liveClient = deps.supervisor.getClient();
      if (!liveClient) throw new Error('SIDECAR_DOWN');

      // (D) Write the dump transcript NOW — AFTER transcription, with the real
      // segments (not the empty pre-transcribe view the old code wrote).
      if (_activeDump) {
        _activeDump.writeTranscript({
          sessionId: 'live',
          language: orch.language,
          llmModel: path.basename(paths.llmPath),
          segments: orch.exposedSegments,
        });
      }

      // (E) Spec §9 — the v2 finalize path needs the LLM loaded before
      // generateWithGrammar can succeed (else `not_loaded`). loadLlmForFinalize
      // unloads STT (idempotent) → loads LLM, SHARED with the from-dump path.
      // Cached per-orchestrator via _llmLoadedForCurrent; reloads after a failed
      // finalize's idle-unload (onSessionSettled nulls the cache).
      //
      // Telemetry: each phase emits its own `sessionLog.phase(...)`
      // breadcrumb so the founder-visible main.log can attribute a long
      // Stop → Note interval to cold-cache (llm-load-finalize huge) vs
      // generation (visible later via [finalize:*] attempts). Without these,
      // a ~4-min run with a 25 s LLM load looks identical to a 25 s retry.
      if (_llmLoadedForCurrent !== orch) {
        await loadLlmForFinalize(liveClient, paths.llmPath);
        _llmLoadedForCurrent = orch;
      }

      // (F) Wedged-retry fix (2026-06-10): resolve the client LAZILY per
      // generate call and restart + LLM-reload on a no-progress stall, so
      // callWithGrammar's fresh-seed retries hit a live process instead of
      // queueing behind a doomed generation in the single-threaded C++
      // dispatch loop. See recovering-grammar-sidecar.ts for the RCA.
      const recoveringSidecar = makeRecoveringSidecarFor(paths.llmPath);

      return {
        sessionId: 'live',   // placeholder — real session-ID assignment lands in Task 13
        segments: orch.exposedSegments,
        llmModelPath: paths.llmPath,
        // orch.language is one of ja/en/ko — all valid NoteLanguage values.
        // (ko reaches here only on a note finalize, which Task 3 rejects.)
        language: orch.language as NoteLanguage,
        // Dump wrap sits OUTSIDE the recovery wrapper so the recorded calls
        // are exactly what callWithGrammar issued (prompt, seed, raw output
        // per attempt) — including attempts that stall and recover.
        sidecar: _activeDump
          ? _activeDump.wrapSidecar(recoveringSidecar)
          : recoveringSidecar,
      };
    },
    // F2 history viewer — from-dump finalize context. NO dump is created for
    // regen runs (P0-1; buildDumpSessionContext never calls createSessionDump).
    getDumpSession: async (id: string) => {
      cancelIdleStop(); // regen is "in use" — settle re-arms via onSessionSettled
      // loadLlm runs UNCONDITIONALLY here (no _llmLoadedForCurrent-style cache):
      // every settle runs unloadLlmIdle, so a dump-run cache would be defeated
      // on the back-to-back regen path anyway. Do not "optimize" this into a
      // stale-cache bug.
      return buildDumpSessionContext(id, {
        baseDir: sessionsBaseDir(),
        isLiveSessionActive: () => current !== null || recording,
        getClient: () => deps.supervisor.getClient() ?? null,
        startClient: async () => {
          const c = deps.supervisor.start();
          await c.waitForReady(5000);
          return c;
        },
        getModelPaths: () => deps.getModelPaths(),
        loadLlm: loadLlmForFinalize,
        makeSidecar: makeRecoveringSidecarFor,
      });
    },
    // Raw-transcript output mode (2026-06-19) — LLM-free whole-WAV transcript.
    // Mirrors getCurrentSession's preamble + steps (A)-(D), then RETURNS the
    // raw segments. Deliberately STOPS before the (E) LLM load and the (F)
    // recovering-sidecar wrap — no note is generated. The transcript cache
    // (exposedSegments) + debug dump are shared with the note path, so a later
    // note finalize on the same orchestrator would reuse this transcription.
    getTranscript: async (): Promise<SessionTranscribeResult> => {
      if (!current) throw new Error('NO_ACTIVE_SESSION');
      const paths = deps.getModelPaths();
      const client = deps.supervisor.getClient();
      if (!paths || !client) throw new Error('NO_ACTIVE_SESSION');
      const orch = current;

      // (A) Debug dump — same as the note path. A transcribe run lands in
      // history via transcript.json; onSessionSettled writes no result.json.
      try {
        _activeDump = createSessionDump({ baseDir: sessionsBaseDir() });
      } catch {
        _activeDump = null;
      }
      if (_activeDump) log.info('[transcribe:dump]', redactPath(_activeDump.dir));

      // (B) Whole-WAV transcription, cached on the orchestrator instance. Skips
      // when a transcript is already held (e.g. a prior note-finalize attempt).
      if (orch.exposedSegments.length === 0) {
        const wavPath = orch.wavPath;
        if (!wavPath || !fs.existsSync(wavPath)) throw new Error('WAV_MISSING');
        const t0 = Date.now();
        const segs = await transcribeWithProgress(
          client,
          paths.sttPath,
          orch.language as NoteLanguage,
          wavPath,
        );
        orch.setFinalizeSegments(segs);
        sessionLog.phase('stt-transcribe-finalize', Date.now() - t0);
      }

      // (C) Empty guard — a silent recording yields no transcript.
      if (orch.exposedSegments.length === 0) throw new Error('EMPTY_RECORDING');

      // (D) Persist the transcript dump with the real segments. llmModel is a
      // required field even though no LLM runs — pass the configured basename.
      if (_activeDump) {
        _activeDump.writeTranscript({
          sessionId: 'live',
          language: orch.language,
          llmModel: path.basename(paths.llmPath),
          segments: orch.exposedSegments,
        });
      }

      // NO LLM load. Spread exposedSegments (readonly) into the mutable result.
      return {
        sessionId: 'live',
        language: orch.language,
        segments: [...orch.exposedSegments],
        durationSec: orch.exposedSegments.at(-1)?.endSec,
      };
    },
    // The v2 Stop flow ends here, not at session/stop — so finalize owns the
    // idle-return. Mirror the session/stop finally block (lines below): clear
    // `current` + `_llmLoadedForCurrent` and drop `recording` so post-finalize
    // chunk callbacks no-op and the next session/start isn't rejected with
    // SESSION_ACTIVE.
    //
    // P0-3 (2026-06-09) — clear ONLY on success. On finalize FAILURE (grammar-
    // parse throw, sidecar generate rejection, LLM-load fail, etc.) we MUST
    // preserve the SessionOrchestrator + its captured `exposedSegments` so the
    // renderer's ErrorView retry button can re-invoke `session/finalize`
    // against the same accumulated transcript. `_llmLoadedForCurrent` stays
    // too — the LLM is already in the sidecar's RAM, no need to re-run the
    // ~25 s load. Audio capture already stopped (Stop fires before
    // familyPicker) so `recording` is already false in both branches. The
    // orchestrator is cleared on next SUCCESSFUL finalize, on session/stop,
    // or on sidecar exit (handleSidecarExit). Without this, a 30-min
    // recording's transcript is GONE on first failure click — see memory
    // v2_30min_real_record_3_p0s_2026-06-09 for the incident this fixes.
    onSessionSettled: (result) => {
      // Debug dump tail: persist the parsed note (success) or the failure
      // reason, then drop the handle — the next finalize creates a fresh dir.
      // The transcript settle variant carries no `family` (and no note /
      // result.json by design); writeResult is family-typed, so guard it —
      // a transcribe run already wrote transcript.json and needs no result.json.
      if ('family' in result) _activeDump?.writeResult(result);
      _activeDump = null;
      // Audio writer: close on BOTH success and failure. Audio capture
      // already stopped before finalize (Stop → FamilyPicker flow), so no
      // more samples arrive regardless of outcome. Close here rather than
      // at session/stop because the v2 flow never hits session/stop.
      closeAudioWriter();
      // Session-scoped lifecycle: the LLM's 3 GB leaves RAM the moment a
      // finalize settles — success or failure. P0-3 still preserves the
      // TRANSCRIPT (current) on failure for retry; the retry re-runs the
      // unload-STT → load-LLM prep because _llmLoadedForCurrent resets.
      unloadLlmIdle();
      _llmLoadedForCurrent = null;
      if (!result.ok) {
        armIdleStop();
        return;
      }
      current = null;
      recording = false;
      armIdleStop();
    },
    // Route (b) latency-decomposition telemetry → sessionLog (founder-visible
    // main.log). Per-event shape matches sessionLog.finalize* methods 1:1
    // modulo the `kind` discriminator. The default arm assigns `e` to `never`
    // so a new FinalizeTelemetryEvent variant fails to compile here until
    // you wire it to the matching log method.
    onTelemetry: (e) => {
      // Renderer progress feed (founder ask 2026-06-13): forward the minimal
      // chunk/attempt shape so curatingV2 shows real work state. The mapper
      // strips reason/family/seed — keep all forwarding behind it.
      const progress = toFinalizeProgressPayload(e);
      if (progress) safeSend(CHANNELS.sessionFinalizeProgress, progress);
      switch (e.kind) {
        case 'attempt-start':
          return; // renderer-only; the completed attempt below carries the log breadcrumb
        case 'attempt':
          sessionLog.finalizeAttempt(e);
          return;
        case 'chunk-done':
          sessionLog.finalizeChunkDone(e);
          return;
        case 'finalize-done':
          sessionLog.finalizeDone(e);
          return;
        default: {
          const _exhaustive: never = e;
          return _exhaustive;
        }
      }
    },
  });

  // ── Export note / transcript to a user-chosen file (Copy/Export buttons) ──
  // Renderer pre-serializes the text; main only shows the save dialog + writes.
  ipcMain.handle(
    CHANNELS.exportFile,
    async (_e, payload: { content: string; defaultName: string }): Promise<{ ok: boolean; canceled: boolean; path?: string }> => {
      const win = deps.getMainWindow();
      const opts = { defaultPath: payload.defaultName };
      const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
      if (res.canceled || !res.filePath) return { ok: false, canceled: true };
      await fs.promises.writeFile(res.filePath, payload.content, 'utf8');
      return { ok: true, canceled: false, path: res.filePath };
    },
  );

  // ── F2 history viewer: dump list + transcript (read-only) ────────────────
  ipcMain.handle(CHANNELS.sessionListDumps, async () => listDumps(sessionsBaseDir()));
  ipcMain.handle(CHANNELS.sessionLoadDump, async (_e, payload: { id: string }) =>
    loadDumpTranscript(sessionsBaseDir(), payload.id));

  // Discard route (2026-06-10, founder request): Stop previously forced every
  // session into FamilyPicker → finalize — an empty/unwanted recording had no
  // exit. Discard drops main-side session state so Start works again.
  // Idempotent; safe to call from any renderer state.
  ipcMain.handle(CHANNELS.sessionDiscard, async () => {
    sessionLog.discard(current !== null);
    closeAudioWriter();
    current = null;
    _llmLoadedForCurrent = null;
    recording = false;
    armIdleStop();
  });

  ipcMain.handle(CHANNELS.sessionStart, async (_e, { language }: SessionStartPayload) => {
    if (_sidecarGaveUp) throw new Error('SIDECAR_GAVE_UP');
    if (current !== null) throw new Error('SESSION_ACTIVE');
    // NOTE: a from-dump finalize holds finalizeInFlight WITHOUT setting `current`,
    // so this guard alone doesn't block start-during-regen — the renderer FSM
    // (curatingV2 has no record button) gates that overlap.
    // ja + en: full notes. ko: transcription-only (notes deferred to Phase 2,
    // see languageCapabilities). zh + unknown codes stay rejected.
    if (!languageCapabilities(language).transcript) throw new Error('UNSUPPORTED_LANGUAGE');
    const paths = deps.getModelPaths();
    if (!paths) throw new Error('MODELS_NOT_CONFIGURED');
    // Record-only start (STT Phase 2): the WAV becomes the SOLE transcript
    // source, transcribed whole at finalize. getModelPaths() returns cached
    // paths validated at resolve time — the STT file could have been moved/
    // deleted since. Fail fast so we never record audio we cannot transcribe.
    if (!fs.existsSync(paths.sttPath)) throw new Error('STT_MODEL_MISSING');
    cancelIdleStop();
    // Lazy respawn: the idle-stop policy (or a user kill while idle) leaves
    // no live sidecar — that is the EXPECTED state now, not an error. Spawn
    // fresh and wait for ready before loading models.
    let client = deps.supervisor.getClient();
    if (!client) {
      client = deps.supervisor.start();
      try {
        await client.waitForReady(5000);
      } catch {
        throw new Error('SIDECAR_DOWN');
      }
    }
    // Fresh adapters per session — survives sidecar respawn without holding
    // stale client refs. WhisperCppSTT / LlamaCppLLM constructors are pure
    // (just stash this.client), so per-session construction is cheap.
    const stt = new WhisperCppSTT(client);
    const llm = new LlamaCppLLM(client);
    const opts: ConstructorParameters<typeof SessionOrchestrator>[0] = {
      stt, llm,
      sttModelPath: paths.sttPath,
      llmModelPath: paths.llmPath,
      language,
    };
    // STT Phase 1 — Whisper proper-noun bias from the optional userData
    // glossary. Empty (default) → omitted → identical to the pre-Phase-1 path.
    const initialPrompt = loadGlossaryInitialPrompt();
    if (initialPrompt) opts.sttInitialPrompt = initialPrompt;
    // Always-on audio capture (STT Phase 2 — the WAV is the SOLE transcript
    // source for whole-file re-transcription at finalize; spec §13).
    // LISNA_DISABLE_AUDIO_SAVE=1 is a test-only kill-switch (default = capture ON).
    // On write failure the session is terminated: a silent disk-full would lose
    // the entire recording with no recovery path.
    _audioWriter = null;
    if (process.env['LISNA_DISABLE_AUDIO_SAVE'] !== '1') {
      try {
        const dir = path.join(app.getPath('userData'), 'audio-captures');
        fs.mkdirSync(dir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const wavPath = path.join(dir, `${stamp}.wav`);
        const w = new WavWriter(wavPath);
        _audioWriter = w;
        opts.wavPath = wavPath;
        opts.onAudioChunk = (audio) => {
          try {
            w.append(audio);
          } catch (err) {
            // Disk-full / write error — WAV is the SOLE transcript source;
            // swallowing this would lose the entire recording silently.
            closeAudioWriter();
            recording = false;
            current = null;
            _llmLoadedForCurrent = null;
            // _activeDump is always null here (created at finalize in
            // getCurrentSession, never at record time) — nothing to clear.
            safeSend(CHANNELS.sessionError, { message: 'AUDIO_WRITE_FAILED' });
            log.error('[audio-capture] write failed — session terminated', err);
          }
        };
        log.info('[audio-capture] saving session audio to', wavPath);
      } catch (err) {
        log.warn('[audio-capture] disabled — could not open writer', err);
        _audioWriter = null;
      }
    }
    const orch = new SessionOrchestrator(opts);
    current = orch;  // claim BEFORE await — concurrent start re-entry blocked synchronously
    _sessionHandlerInFlight = true;
    // Step 5 §4.2 — session-boundary breadcrumb. Emit at the FIRST committed
    // point of start (after all rejection gates pass) so log readers can match
    // start↔stop pairs cleanly without spurious "start lang=ja" entries from
    // rejected attempts.
    sessionLog.start(language);
    try {
      // orch.start() is now a state-reset no-op (STT Phase 2: no live STT load
      // happens at record time; the WAV is transcribed whole at finalize).
      await orch.start();
      recording = true;
    } catch (err) {
      const code = err instanceof Error ? err.message : String(err);
      sessionLog.error(code);
      log.error('[session] start failed', err);
      closeAudioWriter();  // start failed after the writer was opened above → close it (no fd leak)
      current = null;
      _llmLoadedForCurrent = null;
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
  ipcMain.handle(CHANNELS.chunk, (_e, payload: ChunkPayload) => handleChunk(payload));
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
  // P0-2 (2026-06-09) — invalidate the LLM-loaded cache on EVERY sidecar
  // exit, before any other guard. The cache is keyed on the orchestrator
  // INSTANCE, not the sidecar pid; a respawn produces a fresh sidecar
  // process with NO model loaded, so any cached "already loaded for this
  // orchestrator" claim is stale. This MUST run independently of:
  //   (a) the idle short-circuit below (clearing is cheap), and
  //   (b) the in-flight session-handler guard (which suppresses the
  //       renderer `session/error` push but must not suppress cache
  //       invalidation — a crash mid-finalize is the founder 2026-06-09
  //       4-min hang root cause: same orchestrator preserved through
  //       respawn → cache says "loaded" → generate hits a model-less
  //       sidecar → 60s timeout × 2 retries).
  // Companion to P0-3 (onSessionSettled preservation): P0-3 intentionally
  // keeps `current` non-null after finalize failure; this invalidation
  // keeps the LLM-load contract honest when the sidecar respawn happens
  // under P0-3's preserved orchestrator.
  _llmLoadedForCurrent = null;
  if (!current && !recording) return;
  const wasHandlerInFlight = _sessionHandlerInFlight;
  closeAudioWriter();   // sidecar gone — no more audio samples will arrive
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
  closeAudioWriter();   // sidecar gave up — no more audio samples will arrive
  current = null;
  _llmLoadedForCurrent = null;
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
