/** Connector IPC: connect = validate-then-store (a bad key must never persist). */
import { ipcMain } from 'electron';
import Anthropic from '@anthropic-ai/sdk';
import { storeApiKey, loadApiKey, clearApiKey } from './claude-auth';
import { classifyCloudError } from './claude-errors';

export const CONNECTOR_CHANNELS = {
  status: 'connector/status',
  connect: 'connector/connect',
  disconnect: 'connector/disconnect',
} as const;

export interface ConnectorStatus { connected: boolean }

/**
 * A3 (M11+M12) — delegates to the SAME `classifyCloudError` the cloud note
 * path uses instead of a local 2-branch guess. Previously a rate-limited or
 * 5xx moment during connect fell into the catch-all "invalid key" branch,
 * misinforming a user whose key was actually fine. `listModels` is the test
 * seam (mirrors claude-notes.ts's `createClient` DI pattern); production
 * omits it and hits the real SDK call with an explicit 15s timeout so a
 * connect attempt can't hang indefinitely on a slow network.
 */
export async function defaultValidateKey(
  key: string,
  listModels: (key: string) => Promise<unknown> = (k) =>
    new Anthropic({ apiKey: k }).models.list({ limit: 1 }, { timeout: 15_000 }),
): Promise<void> {
  try {
    await listModels(key);
  } catch (err) {
    classifyCloudError(err);
  }
}

export function registerConnectorIpc(deps: { validateKey?: (key: string) => Promise<void> } = {}): void {
  const validateKey = deps.validateKey ?? defaultValidateKey;

  ipcMain.handle(CONNECTOR_CHANNELS.status, async (): Promise<ConnectorStatus> => ({
    connected: (await loadApiKey()) !== null,
  }));

  ipcMain.handle(CONNECTOR_CHANNELS.connect, async (_e, apiKey: unknown): Promise<ConnectorStatus> => {
    if (typeof apiKey !== 'string' || apiKey.trim().length === 0) throw new Error('CONNECTOR_NO_KEY');
    const trimmed = apiKey.trim();
    await validateKey(trimmed);
    await storeApiKey(trimmed);
    return { connected: true };
  });

  ipcMain.handle(CONNECTOR_CHANNELS.disconnect, async (): Promise<ConnectorStatus> => {
    await clearApiKey();
    return { connected: false };
  });
}
