import { app, BrowserWindow } from 'electron';
import { resolve } from 'node:path';

export type UrlSchemeHandler = (url: string) => void | Promise<void>;

let pendingUrl: string | null = null;
let handler: UrlSchemeHandler | null = null;

/**
 * Wire the `lisna://` deep-link handler into the Electron app lifecycle.
 *
 * Must be called BEFORE `app.whenReady()` so:
 *   - `requestSingleInstanceLock()` runs before a second launch races us
 *   - `app.on('open-url', ...)` is registered before macOS dispatches a
 *     cold-start URL (the event can fire DURING `whenReady` resolution)
 *   - `process.argv` is inspected before any other code mutates it
 *
 * Cold-start path: macOS may launch Lisna with a `lisna://...` arg in
 * `process.argv` (Launch Services) — we capture it into `pendingUrl` and
 * dispatch it after the renderer window exists via `flushPendingUrl()`.
 *
 * Warm path: `open-url` (macOS) and `second-instance` (Linux/Windows
 * portability — harmless on macOS) dispatch immediately to the handler.
 */
export function registerUrlScheme(onUrl: UrlSchemeHandler): void {
  handler = onUrl;

  // macOS Launch Services routing:
  //   - Packaged builds: Info.plist `CFBundleURLTypes` (Task 67) covers it.
  //   - Dev (`pnpm dev`): the binary IS Electron itself (not our app), so
  //     Launch Services has no Info.plist entry for `lisna://`. We must
  //     explicitly register at runtime; the argv form is required because
  //     `process.execPath` points at Electron's binary, and we need to
  //     pass our entry-script path so Launch Services can relaunch us.
  //
  // `process.defaultApp` is set when Electron is run via the CLI (dev mode);
  // packaged apps have it undefined. This is the canonical Electron docs
  // switch for protocol-handler registration across both environments.
  if (process.defaultApp) {
    if (process.argv.length >= 2 && process.argv[1] !== undefined) {
      app.setAsDefaultProtocolClient('lisna', process.execPath, [
        resolve(process.argv[1]),
      ]);
    }
  } else {
    app.setAsDefaultProtocolClient('lisna');
  }

  if (!app.requestSingleInstanceLock()) {
    // A second Lisna instance loses the lock — quit immediately so the
    // already-running instance keeps the singleton. The `second-instance`
    // event below (registered on the primary process) will receive any
    // `lisna://` URL passed to this second launch.
    app.quit();
    return;
  }
  app.on('second-instance', (_event, argv) => {
    const url = argv.find((a) => a.startsWith('lisna://'));
    if (url) dispatch(url);
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.on('open-url', (event, url) => {
    event.preventDefault();
    dispatch(url);
  });
  const coldUrl = process.argv.find((a) => a.startsWith('lisna://'));
  if (coldUrl) pendingUrl = coldUrl;
}

/**
 * Drain any URL captured before the renderer window existed.
 *
 * Must be called AFTER `createWindow()` inside the `app.whenReady().then(...)`
 * chain — the eventual handler invocation (auth/signed-in IPC broadcast)
 * needs a live `webContents` to target.
 */
export function flushPendingUrl(): void {
  if (pendingUrl) {
    dispatch(pendingUrl);
    pendingUrl = null;
  }
}

function dispatch(url: string): void {
  if (!handler) {
    pendingUrl = url;
    return;
  }
  void handler(url);
}
