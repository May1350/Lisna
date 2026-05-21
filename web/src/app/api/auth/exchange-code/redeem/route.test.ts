import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/app-auth', () => ({
  redeemExchangeCode: vi.fn(),
  DEVICE_TOKEN_TTL_DAYS_EXPORT: 90,
}));

const { redeemExchangeCode } = await import('@/lib/app-auth');
const { POST } = await import('./route');

describe('POST /api/auth/exchange-code/redeem', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 on missing code', async () => {
    const req = new Request('http://x/api/auth/exchange-code/redeem', { method: 'POST', body: JSON.stringify({}) });
    const res = await POST(req as unknown as Parameters<typeof POST>[0]);
    expect(res.status).toBe(400);
  });

  it('returns 401 on invalid code', async () => {
    (redeemExchangeCode as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('invalid'));
    const req = new Request('http://x/api/auth/exchange-code/redeem', {
      method: 'POST',
      body: JSON.stringify({ code: 'bad' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req as unknown as Parameters<typeof POST>[0]);
    expect(res.status).toBe(401);
  });

  it('returns token on valid code', async () => {
    (redeemExchangeCode as ReturnType<typeof vi.fn>).mockResolvedValue({ userId: 'u1', deviceToken: 'devtok123' });
    const req = new Request('http://x/api/auth/exchange-code/redeem', {
      method: 'POST',
      body: JSON.stringify({ code: 'good' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req as unknown as Parameters<typeof POST>[0]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBe('devtok123');
    expect(body.userId).toBe('u1');
  });
});
