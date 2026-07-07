/** Connector IPC: connect = validate-then-store (a bad key must never persist). */
import { ipcMain } from 'electron';
import Anthropic from '@anthropic-ai/sdk';
import { storeApiKey, loadApiKey, clearApiKey } from './claude-auth';

export const CONNECTOR_CHANNELS = {
  status: 'connector/status',
  connect: 'connector/connect',
  disconnect: 'connector/disconnect',
} as const;

export interface ConnectorStatus { connected: boolean }

async function defaultValidateKey(key: string): Promise<void> {
  try {
    await new Anthropic({ apiKey: key }).models.list({ limit: 1 });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new Error('CONNECTOR_AUTH_INVALID');
    if (err instanceof Anthropic.APIConnectionError) throw new Error('CONNECTOR_OFFLINE');
    throw new Error('CONNECTOR_AUTH_INVALID');
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
