import { app, BrowserWindow, dialog } from 'electron';
// electron-updater is CJS; Node's ESM loader can't pull named exports from it.
// Default-import the module object, then destructure. Removing this pattern
// recreates the v0.1.0 boot crash (SyntaxError on autoUpdater named import).
import electronUpdater from 'electron-updater';
const { autoUpdater } = electronUpdater;
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { registerIpc, handleSidecarExit, handleSidecarGiveUp, setAppQuitting, isSessionInFlight } from './ipc';
import { resolveModels, registerModelIpc } from './model-resolver';
import { installSystemAudioHandler } from './audio/system-audio-handler';
import { SidecarSupervisor } from './sidecar/supervisor';
import { initFileLogger, log, redactPath } from './log';
import { registerUrlScheme, flushPendingUrl } from './url-scheme';
import { handleAuthCallback } from './auth/exchange';

// Step 5 §4.1 — initialize file logger BEFORE any other module that may log
// during boot. macOS log path: ~/Library/Logs/Lisna/main.log (rotating).
initFileLogger();

const __dirname = dirname(fileURLToPath(import.meta.url));

// Module-level so the before-quit hook + handleSidecarExit's safeSend
// (via getMainWindow getter) can reach it.
let supervisor: SidecarSupervisor | undefined;
let mainWindow: BrowserWindow | undefined;
// Set on first `before-quit` so the second pass (after `shutdown()` resolves)
// skips the preventDefault gate and lets Electron quit normally.
let shuttingDown = false;

// ── Zombie-defense Layer B (2026-06-10) ──────────────────────────────────
// The sidecar holds ~3 GB RAM (Llama + Whisper + Metal buffers). Any Electron
// exit path that skips `before-quit` leaves it orphaned — founder-reported
// 10+ times. Every handler below converges on killing the child before the
// main process is allowed to die. Registered at module scope, BEFORE
// whenReady, so they cover boot-phase failures too.

// Last-resort synchronous reaper. `process.on('exit')` runs after the event
// loop is gone — only sync code executes. Covers: app.exit() calls, the tail
// of every graceful quit, and Node-default terminations that still unwind.
process.on('exit', () => {
  supervisor?.panicKill();
});

// Emergency teardown for fatal-but-catchable paths. supervisor.shutdown()
// is internally bounded at 2s (SIGTERM → SIGKILL → hard ceiling), so this
// cannot hang the quit. app.exit (not app.quit) — skip the quit-event chain,
// whose listeners may be the thing that just threw.
let hardShutdownRan = false;
function hardShutdownAndExit(code: number): void {
  if (hardShutdownRan) return;
  hardShutdownRan = true;
  shuttingDown = true; // suppress the before-quit preventDefault pass
  const bail = setTimeout(() => app.exit(code), 2500); // shutdown() ceiling is 2s
  void supervisor?.shutdown().finally(() => {
    clearTimeout(bail);
    app.exit(code);
  });
  if (!supervisor) {
    clearTimeout(bail);
    app.exit(code);
  }
}

// POSIX termination signals: Activity Monitor quit, `kill <pid>`, dev-launcher
// (electron-vite / pnpm dev) teardown, terminal hangup, logout. Node's default
// disposition would die without running before-quit; converting to the
// graceful path lets the sidecar SIGTERM cleanly (Metal teardown) first.
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(sig, () => {
    log.warn(`[lifecycle] ${sig} received — shutting down`);
    hardShutdownAndExit(0);
  });
}

// A main-process throw after boot would otherwise terminate Electron via
// Node's default handler WITHOUT running before-quit — the silent-exit shape
// from the 2026-06-10 RCA (17-min recording lost, sidecar orphaned). Log
// first: the log line is the difference between a diagnosable incident and
// another "app just vanished" report.
process.on('uncaughtException', (err) => {
  log.error('[lifecycle] uncaughtException — emergency shutdown', err);
  hardShutdownAndExit(1);
});

// Logged but NOT fatal: Node's default (throw) would turn any forgotten
// .catch into a full app exit mid-recording. A rejected promise nobody
// awaits is an observability problem, not a process-integrity problem.
process.on('unhandledRejection', (reason) => {
  log.error('[lifecycle] unhandledRejection (non-fatal)', reason);
});

// Renderer death (V8 OOM, GPU fault, native crash) with no listener lets
// Electron destroy the BrowserWindow → window-all-closed → app.quit — the
// load-bearing chain in the 2026-06-10 silent exit. The orchestrator (and
// the in-flight transcript) lives in THIS process, so a webContents.reload()
// is full recovery, not a restart.
app.on('render-process-gone', (_event, contents, details) => {
  log.error('[lifecycle] render-process-gone', details.reason, `exitCode=${details.exitCode}`);
  if (['crashed', 'oom', 'abnormal-exit', 'launch-failed'].includes(details.reason)) {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents === contents);
    if (win && !win.isDestroyed()) {
      win.webContents.reload();
    }
  }
});

// GPU / network-service / utility process deaths are recoverable (Electron
// respawns them) but each one is a breadcrumb for the next incident RCA.
app.on('child-process-gone', (_event, details) => {
  log.warn('[lifecycle] child-process-gone', details.type, details.reason);
});

// Phase M Task 68 — wire the `lisna://` deep-link handler BEFORE `whenReady`.
// `registerUrlScheme` acquires the single-instance lock and installs the
// `open-url` / `second-instance` listeners; macOS may fire `open-url` during
// `whenReady` resolution, so the listener must already be attached. Cold-
// start argv URLs are queued in the module and drained by `flushPendingUrl()`
// after `createWindow()` runs (handler needs a live webContents to target).
registerUrlScheme(async (url) => {
  const parsed = new URL(url);
  if (parsed.host === 'callback') {
    const code = parsed.searchParams.get('code');
    if (code) await handleAuthCallback(code);
  }
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      sandbox: false,
    },
  });
  mainWindow = win;
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = undefined;
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(async () => {
  installSystemAudioHandler();

  // §5.1 — resolve model paths FIRST. Reads <userData>/models.json,
  // existence-checks each path, env-var overrides (LISNA_DEV_STT_MODEL /
  // LISNA_DEV_LLM_MODEL) authoritative when set. Result drives whether
  // renderer mounts Recording (ready) or SetupView (needs-setup).
  const userDataDir = app.getPath('userData');
  // `let` so the post-pick `onStatusChange` callback (passed to registerModelIpc
  // below) can update this in place. registerIpc's `getModelPaths` getter reads
  // through this variable, so a needs-setup → ready transition triggered by
  // the picker correctly propagates to session/start without re-registering.
  let resolveResult = await resolveModels({
    userDataDir,
    envOverride: {
      // Trim + empty→undefined: a set-but-empty env var (`LISNA_DEV_STT_MODEL=""`)
      // should NOT be treated as "use this exact path" — it's user-intent
      // ambiguous (could be a shell-quoting accident). Fall through to disk.
      stt: process.env.LISNA_DEV_STT_MODEL?.trim() || undefined,
      llm: process.env.LISNA_DEV_LLM_MODEL?.trim() || undefined,
    },
  });
  log.info(`[boot] models: ${resolveResult.kind}` +
    (resolveResult.kind === 'ready'
      ? ` STT=${redactPath(resolveResult.sttPath)} LLM=${redactPath(resolveResult.llmPath)}`
      : ` missing=${resolveResult.missing.join(',')}`));

  supervisor = new SidecarSupervisor({
    // Step 5 §3.6 — give-up signals the renderer to switch from "Try again"
    // to "Restart Lisna". handleSidecarGiveUp does the state-flag flip AND
    // pushes session/error with permanent:true. Both fire here: log to
    // console for ops diagnostics, then route to the IPC module so the UI
    // can react.
    //
    // Order invariant: supervisor's handleExit fires onExit FIRST then
    // onCrash. handleSidecarExit runs first (transient push or in-flight
    // suppression), then handleSidecarGiveUp upgrades the state to permanent.
    // App.tsx's idempotent error-state merge keeps the transcript and
    // updates the permanent flag — see App.tsx onSessionError handler.
    onCrash: (msg) => {
      log.error('[sidecar give-up]', msg);
      handleSidecarGiveUp();
    },
    // Single source of truth for renderer notification: clears session state
    // and pushes session/error from ipc.ts module scope.
    onExit: handleSidecarExit,
    // Per-event log noise is keyed on type, not payload (sidecar event payloads
    // contain ready/log/memory data — `type` alone is the breadcrumb). Wired
    // via onSpawn (not once on the boot client) so the breadcrumbs survive
    // crash-respawns and wedge-recovery restarts — a boot-only listener dies
    // silently with the first replaced process.
    onSpawn: (c) => c.onEvent((e) => log.info('[sidecar event]', e.type)),
    // Session-scoped respawn: only resurrect a dead sidecar while a session
    // is actually in flight. An idle-time kill (user's Activity Monitor,
    // jetsam, idle-stop policy) stays dead — the next session/start spawns
    // lazily. Before this gate, the respawn loop fought the founder's
    // force-quits until a machine reboot (2026-06-10).
    shouldRespawn: isSessionInFlight,
  });
  const client = supervisor.start();

  try {
    const ready = await client.waitForReady(5000);
    log.info('[sidecar] ready', ready);
  } catch (err) {
    log.error('[sidecar] failed to reach ready state — recording will fail until restart:', err);
  }

  // §5.1 — register IPC handlers BEFORE createWindow so the renderer's
  // first useEffect (getModelStatus on mount) does not race against
  // handler registration.
  registerIpc({
    getMainWindow: () => mainWindow,  // getter — survives darwin re-create
    supervisor,
    // Lazy getter — re-read every session/start so post-pick paths propagate.
    // See IpcDeps.getModelPaths JSDoc for the freeze-bug this prevents.
    getModelPaths: () => resolveResult.kind === 'ready'
      ? { sttPath: resolveResult.sttPath, llmPath: resolveResult.llmPath }
      : null,
  });
  registerModelIpc({
    getMainWindow: () => mainWindow,
    initialStatus: resolveResult,
    userDataDir,
    // Mutate the outer `resolveResult` so getModelPaths above sees the new
    // ready state. Without this, session/start keeps rejecting MODELS_NOT_
    // CONFIGURED forever after a successful needs-setup → ready transition.
    onStatusChange: (s) => { resolveResult = s; },
  });

  createWindow();

  // Phase M Task 68 — drain any cold-start `lisna://` URL captured by
  // `registerUrlScheme` before the window existed. Must run AFTER
  // `createWindow()` so the handler's eventual `webContents.send` (auth/
  // signed-in broadcast, lands in Task 69) has a live target.
  flushPendingUrl();

  // Phase N Task 74 — silent background update check.
  // autoUpdater.logger wires download-phase + signature events
  // (which fire via the event-emitter, not the Promise chain)
  // to electron-log instead of the default console.
  //
  // autoDownload + auto-notify intentionally DISABLED while builds are
  // unsigned. On unsigned macOS, Squirrel.Mac rejects the post-download
  // signature swap, so checkForUpdatesAndNotify() would surface a fake
  // "Update Downloaded" notification that never actually applies. Once
  // Apple Dev signing lands, swap back to checkForUpdatesAndNotify().
  // checkForUpdates() still runs — it logs "available update" info via
  // autoUpdater.logger so we keep observability for alpha-cycle update
  // channel health.
  autoUpdater.logger = log;
  autoUpdater.autoDownload = false;
  autoUpdater.checkForUpdates().catch(() => {
    // No-op: internal error listener already logs via autoUpdater.logger.
  });
}).catch((err) => {
  // Boot rejection (resolveModels disk failure, supervisor crash mid-init,
  // registerIpc throw, etc.) would otherwise become an unhandled promise
  // rejection: window never opens, sidecar may be half-started, app appears
  // hung at launch with no diagnostic surface. Surface as a dialog the user
  // can actually read, log the cause for post-hoc debugging, then quit so
  // they can relaunch instead of force-killing a zombie process.
  log.error('[boot] fatal — startup chain rejected', err);
  dialog.showErrorBox(
    'Lisna',
    '起動に失敗しました。Lisna を再起動してください。\n\n' +
    (err instanceof Error ? err.message : String(err)),
  );
  app.quit();
});

// Electron's `before-quit` does NOT await async listeners — the app proceeds
// to teardown as soon as the listener returns synchronously. An `async` body
// that awaits `supervisor.shutdown()` therefore races against process exit
// and the SIGTERM→SIGKILL chain may never run to completion. The standard
// Electron pattern is to `preventDefault()` the first pass, run the async
// teardown, then call `app.quit()` to fire `before-quit` a second time —
// gated by a `shuttingDown` flag — which Electron then lets proceed.
app.on('before-quit', (event) => {
  if (shuttingDown) return;
  if (!supervisor) return;
  event.preventDefault();
  shuttingDown = true;
  // setAppQuitting BEFORE supervisor.shutdown so in-flight session/stop
  // catches read it after sidecar SIGTERM rejects their orch.stop.
  setAppQuitting();
  supervisor.shutdown().finally(() => app.quit());
});

// darwin re-open: recreate the window. State (current/recording in ipc.ts) is
// already idle by the time this fires (window-all-closed → app.quit kills the
// process). This hook is defensive against future policy changes that keep the
// app alive past window-all-closed.
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// v2.0 alpha policy: all-windows-closed always quits, even on darwin (the macOS
// default is "stay in dock"). Rationale: single-window app, closing the window
// with a session active would leave ipc.ts current/recording flag stale. Quit
// fully resets the process. v2.1 may revisit when a menu-bar icon or background
// sync arrives.
app.on('window-all-closed', () => app.quit());
