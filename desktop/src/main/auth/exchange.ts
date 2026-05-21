import { log } from '../log';

/**
 * Task 68 stub — Task 69 replaces the body with the real exchange-code
 * redeem (POST `/api/auth/exchange-code`), Keychain store, and `auth/
 * signed-in` IPC broadcast. Kept as a typed no-op so Task 68's URL-scheme
 * wiring typechecks before the redeem logic exists.
 *
 * The `code` arg is logged redacted (first 8 chars) — single-use but
 * still credential-shaped, so we follow the same shape-only logging
 * contract as the rest of `main/`.
 */
export async function handleAuthCallback(code: string): Promise<void> {
  log.info('[auth] lisna:// callback received (stub):', code.slice(0, 8) + '...');
}
