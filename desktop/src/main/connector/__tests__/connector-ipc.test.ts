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

import Anthropic from '@anthropic-ai/sdk';
import { registerConnectorIpc, CONNECTOR_CHANNELS, defaultValidateKey } from '../ipc';

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

// A3 (M11+M12) — defaultValidateKey no longer runs its own 2-branch
// classification; it delegates to the SAME classifyCloudError used by the
// cloud note path, so a transient moment during connect (429/5xx) surfaces
// as RATE_LIMITED/SERVER_BUSY/OFFLINE — not a blanket "invalid key". The
// `listModels` second param is the test seam (mirrors claude-notes.ts's
// `createClient` DI pattern) — production omits it and hits the real
// `models.list({ limit: 1 }, { timeout: 15_000 })` call.
describe('defaultValidateKey (A3 — reuses classifyCloudError)', () => {
  it('valid-key-but-429 rejects with CONNECTOR_RATE_LIMITED, not "invalid key"', async () => {
    const err = new Anthropic.RateLimitError(429, { message: 'rate limited' }, undefined, new Headers());
    await expect(
      defaultValidateKey('sk-ant-x', async () => { throw err; }),
    ).rejects.toThrow('CONNECTOR_RATE_LIMITED');
  });

  it('a 5xx during connect rejects with CONNECTOR_SERVER_BUSY, not "invalid key"', async () => {
    const err = new Anthropic.InternalServerError(503, { message: 'unavailable' }, undefined, new Headers());
    await expect(
      defaultValidateKey('sk-ant-x', async () => { throw err; }),
    ).rejects.toThrow('CONNECTOR_SERVER_BUSY');
  });

  it('a real 401 rejects with CONNECTOR_AUTH_INVALID', async () => {
    const err = new Anthropic.AuthenticationError(401, { message: 'invalid x-api-key' }, undefined, new Headers());
    await expect(
      defaultValidateKey('sk-ant-x', async () => { throw err; }),
    ).rejects.toThrow('CONNECTOR_AUTH_INVALID');
  });

  it('a connection error rejects with CONNECTOR_OFFLINE', async () => {
    const err = new Anthropic.APIConnectionError({ message: 'network down' });
    await expect(
      defaultValidateKey('sk-ant-x', async () => { throw err; }),
    ).rejects.toThrow('CONNECTOR_OFFLINE');
  });

  it('a successful list call resolves without throwing', async () => {
    await expect(defaultValidateKey('sk-ant-x', async () => undefined)).resolves.toBeUndefined();
  });
});
