/**
 * Anthropic API key storage for the LLM connector (spec 2026-07-07 §5, §8a).
 * Key lives ONLY in the macOS Keychain — same service as the device token,
 * per keychain.ts's stated convention. Never written to userData JSON or logs.
 */
import keytar from 'keytar';
import { SERVICE } from '../auth/keychain';

export const ANTHROPIC_KEY_ACCOUNT = 'anthropic_api_key';

export async function storeApiKey(key: string): Promise<void> {
  const trimmed = key.trim();
  if (trimmed.length === 0) throw new Error('CONNECTOR_NO_KEY');
  await keytar.setPassword(SERVICE, ANTHROPIC_KEY_ACCOUNT, trimmed);
}

/**
 * A4 (M18) — a keychain read failure resolves `null` (the same "absent"
 * signal every caller already handles) instead of rejecting. Without this, a
 * transient keytar/Keychain error makes `connectorStatus()` throw and a
 * genuinely connected user gets stuck reading as "not connected".
 */
export async function loadApiKey(): Promise<string | null> {
  try {
    return await keytar.getPassword(SERVICE, ANTHROPIC_KEY_ACCOUNT);
  } catch {
    return null;
  }
}

export async function clearApiKey(): Promise<void> {
  await keytar.deletePassword(SERVICE, ANTHROPIC_KEY_ACCOUNT);
}
