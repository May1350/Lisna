import keytar from 'keytar';

/**
 * macOS Keychain wrapper for the device token issued by
 * `/api/auth/exchange-code/redeem`. The token is bearer-shaped and gates
 * every subsequent app-API call, so it must be stored encrypted at rest.
 *
 * Backend: keytar (native module, prebuilt binary for darwin-arm64).
 * Keytar talks directly to macOS Keychain Services — the OS gates read
 * access by app identity, and the token never lives in plaintext on disk.
 *
 * Service/account naming follows the Electron convention so the token
 * appears as `com.lisna.desktop / device_token` in Keychain Access. Future
 * additions (e.g. refresh tokens, encryption keys) should keep this
 * service name and pick a distinct account name.
 */
const SERVICE = 'com.lisna.desktop';
const ACCOUNT = 'device_token';

export async function storeToken(token: string): Promise<void> {
  await keytar.setPassword(SERVICE, ACCOUNT, token);
}

export async function loadToken(): Promise<string | null> {
  return keytar.getPassword(SERVICE, ACCOUNT);
}

export async function clearToken(): Promise<void> {
  await keytar.deletePassword(SERVICE, ACCOUNT);
}
