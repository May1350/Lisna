import { app, BrowserWindow } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { registerIpc, handleSidecarExit, handleSidecarGiveUp, setAppQuitting } from './ipc';
import { resolveModels, registerModelIpc } from './model-resolver';
import { installSystemAudioHandler } from './audio/system-audio-handler';
import { SidecarSupervisor } from './sidecar/supervisor';
import { initFileLogger, log, redactPath } from './log';

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
  const resolveResult = await resolveModels({
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
  });
  const client = supervisor.start();
  // Per-event log noise is keyed on type, not payload (sidecar event payloads
  // contain ready/log/memory data — `type` alone is the breadcrumb).
  client.onEvent((e) => log.info('[sidecar event]', e.type));

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
    sttModelPath: resolveResult.kind === 'ready' ? resolveResult.sttPath : undefined,
    llmModelPath: resolveResult.kind === 'ready' ? resolveResult.llmPath : undefined,
  });
  registerModelIpc({
    getMainWindow: () => mainWindow,
    initialStatus: resolveResult,
    userDataDir,
  });

  createWindow();
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
