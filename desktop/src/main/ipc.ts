import os from 'node:os';
import path from 'node:path';
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
import type { NoteLanguage } from '@shared/note-schema';
import type { SidecarSupervisor } from './sidecar/supervisor';
import { SessionOrchestrator } from './sidecar/orchestrator';
import { makeGrammarSidecar } from './sidecar/grammar-call';
import { makeRecoveringGrammarSidecar } from './sidecar/recovering-grammar-sidecar';
import { WhisperCppSTT } from './engines/whisper-cpp-stt';
import { LlamaCppLLM } from './engines/llama-cpp-llm';
import { isMacAudioLoopbackSupported } from './platform/hardware-check';
import { log, redactPath, sessionLog } from './log';
import { loadToken } from './auth/keychain';
import { registerSessionFinalize } from './sidecar/ipc/session-finalize';
import { createSessionDump, type SessionDump } from './session-debug-dump';

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
  /** renderer → main: drop the stopped session WITHOUT generating a note.
   *  Clears the orchestrator + LLM-loaded cache so the next session/start
   *  isn't rejected with SESSION_ACTIVE. No-op when nothing is active. */
  sessionDiscard: 'session/discard',
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
  /** renderer → main: v2 finalize replacing session/stop (Task 10).
   *  Lecture branch dispatches finalizeLecture; other families throw
   *  FAMILY_NOT_IMPLEMENTED:<family>:<future-plan>. */
  sessionFinalize: 'session/finalize',
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
    // startMs → seconds: re-anchor Whisper's chunk-relative segment ts to
    // session time (see SessionOrchestrator.onChunk JSDoc).
    const segs = await orch.onChunk(payload.samples, payload.startMs / 1000);
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

      // Debug dump (2026-06-11): one dir per finalize invocation under
      // <userData>/sessions/. Created BEFORE the LLM-load step so even a
      // load failure leaves the transcript on disk — the 13-min coverage-
      // collapse incident was undiagnosable because neither the transcript
      // nor the prompts/raw output ever persisted. app.getPath is guarded:
      // a harness without it just runs the finalize undumped.
      try {
        _activeDump = createSessionDump({
          baseDir: path.join(app.getPath('userData'), 'sessions'),
        });
      } catch {
        _activeDump = null;
      }
      if (_activeDump) {
        log.info('[finalize:dump]', redactPath(_activeDump.dir));
        _activeDump.writeTranscript({
          sessionId: 'live',
          language: current.language,
          llmModel: path.basename(paths.llmPath),
          segments: current.exposedSegments,
        });
      }

      // Spec §9 — the v2 finalize path needs the LLM loaded before
      // generateWithGrammar can succeed (else `not_loaded`). Mirror the
      // 8GB-safe sequence orchestrator.stop() uses internally:
      // unload STT → load LLM. STT unload is idempotent (catch+ignore)
      // so a session that never recorded chunks isn't penalized. Cached
      // per-orchestrator via _llmLoadedForCurrent.
      //
      // Telemetry: each phase emits its own `sessionLog.phase(...)`
      // breadcrumb so the founder-visible main.log can attribute a long
      // Stop → Note interval to cold-cache (llm-load-finalize huge) vs
      // generation (visible later via [finalize:*] attempts). Without these,
      // a ~4-min run with a 25 s LLM load looks identical to a 25 s retry.
      if (_llmLoadedForCurrent !== current) {
        const stt = new WhisperCppSTT(client);
        const llm = new LlamaCppLLM(client);
        const sttT0 = Date.now();
        await stt.unloadModel().catch(() => {
          // STT may not have been loaded (no recording happened, or already
          // unloaded by a prior finalize). Either way, proceed to LLM load.
        });
        sessionLog.phase('stt-unload-finalize', Date.now() - sttT0);
        const llmT0 = Date.now();
        await llm.loadModel(paths.llmPath);
        sessionLog.phase('llm-load-finalize', Date.now() - llmT0);
        _llmLoadedForCurrent = current;
      }

      // Wedged-retry fix (2026-06-10): resolve the client LAZILY per
      // generate call and restart + LLM-reload on a no-progress stall, so
      // callWithGrammar's fresh-seed retries hit a live process instead of
      // queueing behind a doomed generation in the single-threaded C++
      // dispatch loop. See recovering-grammar-sidecar.ts for the RCA.
      const recoveringSidecar = makeRecoveringGrammarSidecar({
        getSidecar: () => {
          const c = deps.supervisor.getClient();
          return c ? makeGrammarSidecar(c) : null;
        },
        recover: async () => {
          log.warn('[finalize] generate stalled (no progress) — restarting sidecar + reloading LLM');
          const t0 = Date.now();
          try {
            const fresh = await deps.supervisor.restart();
            await fresh.waitForReady(5000);
            await new LlamaCppLLM(fresh).loadModel(paths.llmPath);
            sessionLog.phase('llm-reload-recovery', Date.now() - t0);
          } catch (e) {
            // Force the next session/finalize call to re-run the full
            // unload-STT → load-LLM prep instead of trusting the cache.
            _llmLoadedForCurrent = null;
            throw e;
          }
        },
      });

      return {
        sessionId: 'live',   // placeholder — real session-ID assignment lands in Task 13
        segments: current.exposedSegments,
        llmModelPath: paths.llmPath,
        // Gate above admits only ja/en, both valid NoteLanguage values.
        language: current.language as NoteLanguage,
        // Dump wrap sits OUTSIDE the recovery wrapper so the recorded calls
        // are exactly what callWithGrammar issued (prompt, seed, raw output
        // per attempt) — including attempts that stall and recover.
        sidecar: _activeDump
          ? _activeDump.wrapSidecar(recoveringSidecar)
          : recoveringSidecar,
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
      _activeDump?.writeResult(result);
      _activeDump = null;
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
      switch (e.kind) {
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

  // Discard route (2026-06-10, founder request): Stop previously forced every
  // session into FamilyPicker → finalize — an empty/unwanted recording had no
  // exit. Discard drops main-side session state so Start works again.
  // Idempotent; safe to call from any renderer state.
  ipcMain.handle(CHANNELS.sessionDiscard, async () => {
    sessionLog.discard(current !== null);
    current = null;
    _llmLoadedForCurrent = null;
    recording = false;
    armIdleStop();
  });

  ipcMain.handle(CHANNELS.sessionStart, async (_e, { language }: SessionStartPayload) => {
    if (_sidecarGaveUp) throw new Error('SIDECAR_GAVE_UP');
    if (current !== null) throw new Error('SESSION_ACTIVE');
    // Minimal EN support (2026-06-10): ja + en accepted. ko/zh stay gated —
    // prompts are adapted via renderSystemTemplate but un-eval'd, and the
    // bundled STT models cover ja (kotoba) / multilingual (large-v3-turbo).
    if (language !== 'ja' && language !== 'en') throw new Error('UNSUPPORTED_LANGUAGE');
    const paths = deps.getModelPaths();
    if (!paths) throw new Error('MODELS_NOT_CONFIGURED');
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
      _llmLoadedForCurrent = null;
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
