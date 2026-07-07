import { describe, it, expect, vi, beforeEach } from 'vitest';

const handlers = new Map<string, (...a: unknown[]) => unknown>();
vi.mock('electron', () => ({
  ipcMain: { handle: (ch: string, fn: never) => handlers.set(ch, fn) },
}));
const store = { key: null as string | null };
vi.mock('../claude-auth', () => ({
  storeApiKey: vi.fn(async (k: string) => { store.key = k; }),
  loadApiKey: vi.fn(async () => store.key),
  clearApiKey: vi.fn(async () => { store.key = null; }),
}));

import { registerConnectorIpc, CONNECTOR_CHANNELS } from '../ipc';

const invoke = (ch: string, ...args: unknown[]) => handlers.get(ch)!({}, ...args);

describe('connector IPC', () => {
  beforeEach(() => { handlers.clear(); store.key = null; });

  it('status reflects key presence', async () => {
    registerConnectorIpc({ validateKey: async () => {} });
    await expect(invoke(CONNECTOR_CHANNELS.status)).resolves.toEqual({ connected: false });
    store.key = 'sk-ant-x';
    await expect(invoke(CONNECTOR_CHANNELS.status)).resolves.toEqual({ connected: true });
  });

  it('connect validates BEFORE storing; invalid key stores nothing', async () => {
    registerConnectorIpc({ validateKey: async () => { throw new Error('CONNECTOR_AUTH_INVALID'); } });
    await expect(invoke(CONNECTOR_CHANNELS.connect, 'bad')).rejects.toThrow('CONNECTOR_AUTH_INVALID');
    expect(store.key).toBeNull();
  });

  it('connect stores after successful validation and returns connected', async () => {
    registerConnectorIpc({ validateKey: async () => {} });
    await expect(invoke(CONNECTOR_CHANNELS.connect, ' sk-ant-y ')).resolves.toEqual({ connected: true });
    expect(store.key).toBe('sk-ant-y');
  });

  it('rejects non-string payloads with CONNECTOR_NO_KEY', async () => {
    registerConnectorIpc({ validateKey: async () => {} });
    await expect(invoke(CONNECTOR_CHANNELS.connect, 42)).rejects.toThrow('CONNECTOR_NO_KEY');
  });

  it('disconnect clears and returns disconnected', async () => {
    registerConnectorIpc({ validateKey: async () => {} });
    store.key = 'sk-ant-z';
    await expect(invoke(CONNECTOR_CHANNELS.disconnect)).resolves.toEqual({ connected: false });
    expect(store.key).toBeNull();
  });
});
