import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('keytar', () => ({
  default: {
    setPassword: vi.fn(async () => {}),
    getPassword: vi.fn(async () => null as string | null),
    deletePassword: vi.fn(async () => true),
  },
}));

import { storeApiKey, loadApiKey, clearApiKey, ANTHROPIC_KEY_ACCOUNT } from '../claude-auth';
import keytar from 'keytar';

const setPassword = vi.mocked(keytar.setPassword);
const getPassword = vi.mocked(keytar.getPassword);
const deletePassword = vi.mocked(keytar.deletePassword);

describe('claude-auth', () => {
  beforeEach(() => vi.clearAllMocks());

  it('stores under the shared keychain service with the anthropic account', async () => {
    await storeApiKey('sk-ant-test');
    expect(setPassword).toHaveBeenCalledWith('com.lisna.desktop', ANTHROPIC_KEY_ACCOUNT, 'sk-ant-test');
  });

  it('loads the stored key (null when absent)', async () => {
    getPassword.mockResolvedValueOnce('sk-ant-test');
    await expect(loadApiKey()).resolves.toBe('sk-ant-test');
    await expect(loadApiKey()).resolves.toBeNull();
  });

  it('clears the key', async () => {
    await clearApiKey();
    expect(deletePassword).toHaveBeenCalledWith('com.lisna.desktop', ANTHROPIC_KEY_ACCOUNT);
  });

  it('rejects empty/whitespace keys before touching the keychain', async () => {
    await expect(storeApiKey('  ')).rejects.toThrow('CONNECTOR_NO_KEY');
    expect(setPassword).not.toHaveBeenCalled();
  });
});
