import { app, BrowserWindow } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { registerIpc } from './ipc';
import { installSystemAudioHandler } from './audio/system-audio-handler';
import { SidecarSupervisor } from './sidecar/supervisor';

const __dirname = dirname(fileURLToPath(import.meta.url));

registerIpc();

// Module-level so the before-quit hook can reach it. `sidecarReady` is declared
// for Phase 2.6/2.7 IPC handlers to gate on; not used yet in Phase 2.5.
let supervisor: SidecarSupervisor | undefined;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let sidecarReady = false;

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
  try {
    const ready = await client.waitForReady(5000);
    sidecarReady = true;
    console.log('[sidecar] ready', ready);
  } catch (err) {
    console.error('[sidecar] failed to reach ready state:', err);
  }
  createWindow();
});

app.on('before-quit', async () => {
  await supervisor?.shutdown();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
