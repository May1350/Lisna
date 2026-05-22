import { hostname } from 'node:os';
import { BrowserWindow } from 'electron';
import { log } from '../log';
import { CHANNELS } from '../ipc';
import { storeToken } from './keychain';

/**
 * Server endpoint for the exchange-code redeem flow. Configurable via
 * `LISNA_WEB_URL` env var for local-dev / staging targets (e.g.
 * `http://localhost:3000`); falls back to the production origin.
 */
const REDEEM_URL = process.env.LISNA_WEB_URL ?? 'https://lisna.jp';

/**
 * Fetch timeout for the redeem POST. Production responds in <500ms;
 * 30s primarily protects against captive-portal / DNS-hang scenarios
 * where the user would otherwise be stuck staring at the deep-link
 * landing window with nothing happening.
 */
const REDEEM_TIMEOUT_MS = 30_000;

/**
 * Handles the `lisna://callback?code=...` cold-start / single-instance
 * deep link. Posts the exchange code to the web origin, stores the
 * returned device token in macOS Keychain, and broadcasts
 * `auth/signed-in` so the renderer can swap the sign-in view for the
 * authenticated shell.
 *
 * The device `name` field (`os.hostname()`) closes FU-L-10 — the server
 * previously hard-coded 'Mac' for every device row in `app_devices`,
 * which made the device list useless once a user had more than one
 * machine. The hostname is realistically <= 64 chars on macOS; the
 * server clamps to 100 defensively.
 *
 * Failures are logged at error level but do not throw — the URL-scheme
 * handler in `index.ts` is fire-and-forget, and there's no useful
 * caller-side recovery. The sign-in view stays visible so the user can
 * retry by clicking the "Sign in" button again.
 */
export async function handleAuthCallback(code: string): Promise<void> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REDEEM_TIMEOUT_MS);
  try {
    const res = await fetch(`${REDEEM_URL}/api/auth/exchange-code/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, name: hostname() }),
      signal: ac.signal,
    });
    if (!res.ok) {
      log.error(`[auth] exchange-code redeem failed: ${res.status}`);
      return;
    }
    const { token } = (await res.json()) as { token: string };
    await storeToken(token);
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(CHANNELS.authSignedIn);
    }
    log.info('[auth] signed in, token stored');
  } catch (err) {
    log.error(`[auth] exchange-code redeem error: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}
