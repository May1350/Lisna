// web/src/app/api/auth/refresh/route.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => ({ returning: vi.fn(() => Promise.resolve([{ id: 'd1' }])) })) })) })),
  },
}));

const { POST } = await import('./route');

describe('POST /api/auth/refresh', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 without Bearer header', async () => {
    const res = await POST(new Request('http://x', { method: 'POST' }) as unknown as Parameters<typeof POST>[0]);
    expect(res.status).toBe(401);
  });

  it('returns 401 with malformed Authorization header', async () => {
    const res = await POST(new Request('http://x', { method: 'POST', headers: { authorization: 'Basic abc' } }) as unknown as Parameters<typeof POST>[0]);
    expect(res.status).toBe(401);
  });

  it('returns 200 on valid bearer match', async () => {
    const res = await POST(new Request('http://x', { method: 'POST', headers: { authorization: 'Bearer valid-token' } }) as unknown as Parameters<typeof POST>[0]);
    expect(res.status).toBe(200);
  });
});
