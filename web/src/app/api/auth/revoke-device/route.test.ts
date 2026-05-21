// web/src/app/api/auth/revoke-device/route.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/db', () => ({
  db: {
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => ({ returning: vi.fn(() => Promise.resolve([{ id: 'd1' }])) })) })) })),
  },
}));

const { auth } = await import('@/lib/auth');
const { POST } = await import('./route');

describe('POST /api/auth/revoke-device', () => {
  beforeEach(() => vi.clearAllMocks());
  it('returns 401 without session', async () => {
    (auth as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ id: 'd1' }), headers: { 'Content-Type': 'application/json' } }) as unknown as Parameters<typeof POST>[0]);
    expect(res.status).toBe(401);
  });
  it('returns 200 on successful revoke', async () => {
    (auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: 'u1' } });
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ id: 'd1' }), headers: { 'Content-Type': 'application/json' } }) as unknown as Parameters<typeof POST>[0]);
    expect(res.status).toBe(200);
  });
});
