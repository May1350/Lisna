import { app, BrowserWindow } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { registerIpc } from './ipc';
import { installSystemAudioHandler } from './audio/system-audio-handler';
import { SidecarSupervisor } from './sidecar/supervisor';
import { WhisperCppSTT } from './engines/whisper-cpp-stt';
import type { STTEngine } from '@shared/engine-interfaces';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Module-level so the before-quit hook can reach it.
let supervisor: SidecarSupervisor | undefined;
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
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(async () => {
  installSystemAudioHandler();
  supervisor = new SidecarSupervisor({
    onCrash: (msg) => console.error('[sidecar fatal]', msg),
  });
  const client = supervisor.start();
  client.onEvent((e) => console.log('[sidecar event]', e.type));

  let stt: STTEngine | undefined;

  try {
    const ready = await client.waitForReady(5000);
    console.log('[sidecar] ready', ready);

    const modelPath = process.env.LISNA_DEV_STT_MODEL;
    if (modelPath) {
      try {
        const adapter = new WhisperCppSTT(client);
        await adapter.loadModel(modelPath, 'ja');
        stt = adapter;
        console.log('[stt] model loaded from', modelPath);
      } catch (err) {
        console.error('[stt] model load failed — recording will work without captions:', err);
      }
    }
  } catch (err) {
    console.error('[sidecar] failed to reach ready state — recording will work without captions:', err);
  }

  registerIpc({ stt });
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
  supervisor.shutdown().finally(() => app.quit());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
