import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { app, ipcMain, shell, dialog, type BrowserWindow } from 'electron';
import { WavWriter } from './audio-wav-writer';
import { buildInitialPrompt, parseGlossary } from '@shared/stt/glossary';
import { loadGlossary, saveGlossary } from './glossary-store';
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
import { saveTranscriptEdit, type EditedSegment } from './transcript-edit';
import { WhisperCppSTT } from './engines/whisper-cpp-stt';
import { LlamaCppLLM } from './engines/llama-cpp-llm';
import { TIMEOUTS } from './sidecar/timeouts';
import { isMacAudioLoopbackSupported } from './platform/hardware-check';
import { log, redactPath, sessionLog } from './log';
import { loadToken } from './auth/keychain';
import { registerSessionFinalize } from './sidecar/ipc/session-finalize';
import type { SessionContext } from './sidecar/ipc/session-finalize';
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
  /** renderer → main: read the user's proper-noun glossary (Terms UI). → string[] */
  glossaryGet: 'glossary/get',
  /** renderer → main: persist the glossary (atomic). Returns the NORMALIZED list
   *  (trim/dedupe/cap) so the UI reflects exactly what was stored. */
  glossarySet: 'glossary/set',
  /** renderer → main: persist edited transcript segment text to a dump's
   *  transcript.json (atomic, text-only, merged by index). id validated by
   *  resolveDumpDir (rejects traversal/symlink). */
  transcriptSave: 'transcript/save',
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
// Tracks the wavPath (generation identity) whose LLM has been loaded for the v2
// finalize path. Spec §9 — IPC finalize needs an explicit unload-STT → load-LLM
// prep step (unlike orchestrator.stop(), which loads inline). When
// `_llmLoadedForWav !== snap.wavPath`, the generation performs the load + caches;
// a retry of the SAME wavPath is a no-op. Reset every settle (onSessionSettled),
// on sidecar exit/give-up, and on a failed recovery reload. Keyed on wavPath (not
// the orchestrator instance) so the generation lane is decoupled from `current`
// (Task 3, spec §4.2).
let _llmLoadedForWav: string | null = null;
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
// Generation lane (≤1) in-flight gate, lifted from session-finalize.ts (Task 1)
// so it's lifecycle-visible: it counts in isSessionInFlight() (a background
// generation crash must respawn the sidecar) and is the single-generation
// no-collision guarantee. Set by beginGeneration() (passed to
// registerSessionFinalize), cleared in onSessionSettled.
let genInFlight = false;

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
 *  session is actually using it. Exported for index.ts wiring. `genInFlight`
 *  is counted so a background generation (capture may already be freed →
 *  current/recording false) still resurrects a crashed sidecar. */
export function isSessionInFlight(): boolean {
  return current !== null || recording || genInFlight;
}

/** Generation-lane gate (Task 1). Throws FINALIZE_IN_FLIGHT if a generation is
 *  already running (the single-generation no-collision guarantee); else marks
 *  it in flight. Cleared in onSessionSettled. Passed to registerSessionFinalize. */
function beginGeneration(): void {
  if (genInFlight) throw new Error('FINALIZE_IN_FLIGHT');
  genInFlight = true;
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
        _llmLoadedForWav = null;
        throw e;
      }
    },
  });
}

/** A generation runs from this snapshot, NOT the live orchestrator — so it
 *  survives the capture being freed (Task 4) or a different recording going live. */
interface GenSnapshot {
  wavPath: string;
  language: NoteLanguage;
}

/**
 * At Stop+pick, snapshot the live recording's {wavPath, language} and FREE the
 * capture lane (close the writer, null `current`, drop `recording`) so the
 * stopped recording's generation runs from the snapshot while a NEW recording
 * can start immediately (Task 4, spec §4.2). The WAV is flushed + on disk, so
 * the generation reads it after the writer closes. Caller verifies `current`.
 */
function snapshotAndFreeCapture(): GenSnapshot {
  const orch = current!;
  const snap: GenSnapshot = { wavPath: orch.wavPath ?? '', language: orch.language as NoteLanguage };
  closeAudioWriter();
  current = null;
  recording = false;
  return snap;
}

/**
 * Run a background note generation from a {wavPath, language} snapshot — the
 * former getCurrentSession body (steps A–F) lifted out of the live-orchestrator
 * closure (Task 3, spec §4.2). Transcribes the whole WAV (cached on genSegments),
 * loads the LLM, and returns the SessionContext the family router consumes.
 * Throws WAV_MISSING / EMPTY_RECORDING / SIDECAR_DOWN keyed on the snapshot.
 */
async function runGenerationContext(snap: GenSnapshot): Promise<SessionContext> {
  const paths = _depsRef!.getModelPaths();
  const client = _depsRef!.supervisor.getClient();
  if (!paths || !client) throw new Error('SIDECAR_DOWN');

  // (A) Debug dump — one dir per generation invocation (retries included), so a
  // transcription / LLM-load failure still leaves result.json on disk.
  try {
    _activeDump = createSessionDump({ baseDir: sessionsBaseDir() });
  } catch {
    _activeDump = null;
  }
  if (_activeDump) log.info('[finalize:dump]', redactPath(_activeDump.dir));

  // (B) Whole-WAV STT. The transcript lives on the generation lane (this local),
  // NOT on `current` — the capture is freed at pick (Task 4). A failed-generation
  // retry is dump-based (History regen reads transcript.json), so there is no
  // cross-call live cache to reuse.
  if (!snap.wavPath || !fs.existsSync(snap.wavPath)) throw new Error('WAV_MISSING');
  const t0 = Date.now();
  const segments = await transcribeWithProgress(client, paths.sttPath, snap.language, snap.wavPath);
  sessionLog.phase('stt-transcribe-finalize', Date.now() - t0);

  // (C) Empty guard — before the wasted 3 GB LLM load.
  if (segments.length === 0) throw new Error('EMPTY_RECORDING');

  // (C2) RE-RESOLVE the live client after transcribe — the H1 stall watchdog may
  // have restarted the sidecar PROCESS, leaving the pre-(B) client dead.
  const liveClient = _depsRef!.supervisor.getClient();
  if (!liveClient) throw new Error('SIDECAR_DOWN');

  // (D) Write the dump transcript with the real segments.
  if (_activeDump) {
    _activeDump.writeTranscript({
      sessionId: 'live',
      language: snap.language,
      llmModel: path.basename(paths.llmPath),
      segments,
    });
  }

  // (E) Spec §9 LLM prep (unload STT → load LLM), cached per wavPath; reset every
  // settle (onSessionSettled) so a retry after a failed gen reloads.
  if (_llmLoadedForWav !== snap.wavPath) {
    await loadLlmForFinalize(liveClient, paths.llmPath);
    _llmLoadedForWav = snap.wavPath;
  }

  // (F) Recovering sidecar for fresh-seed retries (lazy per-generate client).
  const recoveringSidecar = makeRecoveringSidecarFor(paths.llmPath);

  return {
    sessionId: 'live',   // placeholder — real session-ID assignment lands in Task 13
    segments,
    llmModelPath: paths.llmPath,
    language: snap.language,
    // Dump wrap sits OUTSIDE the recovery wrapper so the recorded calls are
    // exactly what callWithGrammar issued (prompt, seed, raw output per attempt).
    sidecar: _activeDump ? _activeDump.wrapSidecar(recoveringSidecar) : recoveringSidecar,
  };
}

/**
 * LLM-free whole-WAV transcript from a snapshot — the former getTranscript body
 * (steps A–D) lifted out (Task 3). Same dump + transcribe path as
 * runGenerationContext; STOPS before the LLM load.
 */
async function runTranscriptContext(snap: GenSnapshot): Promise<SessionTranscribeResult> {
  const paths = _depsRef!.getModelPaths();
  const client = _depsRef!.supervisor.getClient();
  if (!paths || !client) throw new Error('NO_ACTIVE_SESSION');

  // (A) Debug dump — a transcribe run lands in history via transcript.json.
  try {
    _activeDump = createSessionDump({ baseDir: sessionsBaseDir() });
  } catch {
    _activeDump = null;
  }
  if (_activeDump) log.info('[transcribe:dump]', redactPath(_activeDump.dir));

  // (B) Whole-WAV STT (generation-lane local — capture is freed at pick).
  if (!snap.wavPath || !fs.existsSync(snap.wavPath)) throw new Error('WAV_MISSING');
  const t0 = Date.now();
  const segments = await transcribeWithProgress(client, paths.sttPath, snap.language, snap.wavPath);
  sessionLog.phase('stt-transcribe-finalize', Date.now() - t0);

  // (C) Empty guard — a silent recording yields no transcript.
  if (segments.length === 0) throw new Error('EMPTY_RECORDING');

  // (D) Persist the transcript dump with the real segments. llmModel is a
  // required field even though no LLM runs — pass the configured basename.
  if (_activeDump) {
    _activeDump.writeTranscript({
      sessionId: 'live',
      language: snap.language,
      llmModel: path.basename(paths.llmPath),
      segments,
    });
  }

  return {
    sessionId: 'live',
    language: snap.language,
    segments: [...segments],
    durationSec: segments.at(-1)?.endSec,
    // undefined when no dump dir was created → renderer renders view-only.
    dumpId: _activeDump ? path.basename(_activeDump.dir) : undefined,
  };
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
    beginGeneration,  // Task 1 — single-generation gate, lifecycle-visible
    // Thin adapter: at pick, FREE the capture lane (Task 4) and delegate the
    // background generation to runGenerationContext. null → NO_ACTIVE_SESSION.
    getCurrentSession: async () => {
      if (!current) return null;
      if (!deps.getModelPaths() || !deps.supervisor.getClient()) return null;
      return runGenerationContext(snapshotAndFreeCapture());
    },
    // F2 history viewer — from-dump finalize context. NO dump is created for
    // regen runs (P0-1; buildDumpSessionContext never calls createSessionDump).
    getDumpSession: async (id: string) => {
      cancelIdleStop(); // regen is "in use" — settle re-arms via onSessionSettled
      // loadLlm runs UNCONDITIONALLY here (no _llmLoadedForWav-style cache):
      // every settle runs unloadLlmIdle, so a dump-run cache would be defeated
      // on the back-to-back regen path anyway. Do not "optimize" this into a
      // stale-cache bug.
      return buildDumpSessionContext(id, {
        baseDir: sessionsBaseDir(),
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
    // Thin adapter: at pick, FREE the capture lane (Task 4) and delegate the
    // LLM-free whole-WAV transcript to runTranscriptContext. No note generated.
    getTranscript: async (): Promise<SessionTranscribeResult> => {
      if (!current) throw new Error('NO_ACTIVE_SESSION');
      if (!deps.getModelPaths() || !deps.supervisor.getClient()) throw new Error('NO_ACTIVE_SESSION');
      return runTranscriptContext(snapshotAndFreeCapture());
    },
    // GENERATION-LANE ONLY (Task 4, spec §4.1 table + §5 #2). The capture lane
    // (current / recording / _audioWriter) is freed at PICK time
    // (snapshotAndFreeCapture) for a valid generation, so settle must NOT touch
    // it — by the time a generation settles, `current` may be a DIFFERENT live
    // recording (scenario 2). This clears only the generation lane: the gate,
    // the dump, the LLM cache, and the transcript cache. The recording is never
    // lost on failure — its transcript is in the dump (written before the LLM
    // stage), and History regen reads it (the new retry path; live retry is gone
    // with the capture-free, replacing the P0-3 preserve-current mechanism).
    onSessionSettled: (result) => {
      genInFlight = false;
      // Debug dump tail: persist the parsed note (success) or the failure reason.
      // Transcript settles carry no `family` (no result.json by design) — guard it.
      if ('family' in result) _activeDump?.writeResult(result);
      _activeDump = null;
      // The 3 GB LLM leaves RAM the moment a finalize settles (8 GB floor).
      unloadLlmIdle();
      _llmLoadedForWav = null;
      // Re-arm idle-stop — fires only if BOTH lanes are idle (isSessionInFlight).
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

  // ── Glossary (Terms UI): read/write the proper-noun list that biases STT ──
  ipcMain.handle(CHANNELS.glossaryGet, async (): Promise<string[]> =>
    loadGlossary(app.getPath('userData')));
  ipcMain.handle(CHANNELS.glossarySet, async (_e, payload: { terms: string[] }): Promise<string[]> =>
    saveGlossary(app.getPath('userData'), Array.isArray(payload?.terms) ? payload.terms : []));
  ipcMain.handle(
    CHANNELS.transcriptSave,
    async (_e, payload: { id: string; segments: EditedSegment[] }): Promise<{ ok: boolean }> => {
      await saveTranscriptEdit(sessionsBaseDir(), payload.id, Array.isArray(payload?.segments) ? payload.segments : []);
      return { ok: true };
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
    _llmLoadedForWav = null;
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
            _llmLoadedForWav = null;
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
      _llmLoadedForWav = null;
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
 *
 * LANE-AWARE (Task 2, spec §4.5). A sidecar exit is a GENERATION-lane event:
 * only generation talks to the sidecar (capture is model-free — renderer audio
 * → WavWriter, never the sidecar). So this:
 *   - ALWAYS invalidates the generation lane (`_llmLoadedForWav`,
 *     `genInFlight`, `_activeDump`), and
 *   - NEVER closes the capture writer / nulls `current`/`recording` when a
 *     capture is live — the crash didn't break capture; the respawn gate
 *     (isSessionInFlight, true via current/recording/genInFlight) resurrects
 *     the sidecar and the recording keeps appending to its WAV.
 *   The escape hatch from a stuck session is now `session/discard`, not a crash.
 *
 * **Why the in-flight guard:** the supervisor's `proc.on('exit', handleExit)`
 * listener fires synchronously; SidecarClient's `rejectAllPending` schedules
 * pending rejections on the microtask queue. So when a sidecar crashes
 * mid-`session/start`, this runs BEFORE the handler's catch/finally completes —
 * `current` is still non-null. When a session/start handler is in-flight, that
 * handler's own catch clears `current` and its IPC rejection surfaces the error;
 * we suppress the push to avoid a double error-view transition.
 *
 * `GENERATION_SIDECAR_DOWN` is a non-blocking code: the renderer (Task 8) marks
 * an active backgroundJob failed and otherwise ignores it — a live recording is
 * undisturbed. (P0-2: the cache invalidation below is the founder 2026-06-09
 * 4-min hang fix — a respawn produces a model-less sidecar, so any cached
 * "loaded for this orchestrator" claim is stale.)
 */
export function handleSidecarExit() {
  // Generation lane: invalidated on EVERY sidecar exit (P0-2 cache honesty —
  // the cache is keyed on the orchestrator INSTANCE, not the sidecar pid).
  _llmLoadedForWav = null;
  genInFlight = false;
  _activeDump = null;
  // Capture lane: untouched. If no capture is live there is nothing to surface
  // (an idle crash, or a background generation whose capture was already freed —
  // that generation's own IPC rejection surfaces its failure).
  if (current === null && !recording) return;
  // A capture IS live — preserve it (do NOT closeAudioWriter / null
  // current/recording). When a session/start is mid-flight its own rejection
  // surfaces the error; otherwise surface a non-blocking generation failure.
  if (_sessionHandlerInFlight) return;
  _safeSend?.(CHANNELS.sessionError, { message: 'GENERATION_SIDECAR_DOWN' });
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
  genInFlight = false;  // generation lane torn down (Task 2)
  // Give-up is PERMANENT — the renderer shows "Restart Lisna" and the app
  // relaunches, so (unlike the transient handleSidecarExit) the capture cannot
  // meaningfully continue. Cleanly close the writer to flush + save the WAV the
  // user already captured, then clear the capture lane.
  closeAudioWriter();
  current = null;
  _llmLoadedForWav = null;
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
