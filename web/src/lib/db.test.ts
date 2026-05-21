import { describe, expect, it, vi } from 'vitest';

// Stub env so makePool() uses the DATABASE_URL branch and doesn't throw at import time.
vi.mock('./env', () => ({
  env: {
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    RDS_PROXY_ENDPOINT: undefined,
    RDS_USERNAME: undefined,
    AWS_REGION: 'ap-northeast-1',
  },
}));

describe('db module', () => {
  it('exports db and getIamToken', async () => {
    const mod = await import('./db');
    expect(typeof mod.db).toBe('object');
    expect(typeof mod.getIamToken).toBe('function');
  });
});
