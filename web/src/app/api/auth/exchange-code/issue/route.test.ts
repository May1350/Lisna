import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth', () => ({
  auth: vi.fn(),
}));
vi.mock('@/lib/app-auth', () => ({
  issueExchangeCode: vi.fn(),
  buildCallbackUrl: vi.fn(),
}));

const { auth } = await import('@/lib/auth');
const { issueExchangeCode, buildCallbackUrl } = await import('@/lib/app-auth');
const { GET } = await import('./route');

const buildReq = (url: string) => new Request(url) as unknown as Parameters<typeof GET>[0];

describe('GET /api/auth/exchange-code/issue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: 'u1' } });
    (issueExchangeCode as ReturnType<typeof vi.fn>).mockResolvedValue('abc123');
    (buildCallbackUrl as ReturnType<typeof vi.fn>).mockImplementation(
      (cb: string, code: string) => `${cb}?code=${code}`,
    );
  });

  it('redirects unauthenticated users to /signin with Cache-Control: no-store', async () => {
    (auth as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await GET(buildReq('http://x/api/auth/exchange-code/issue'));
    expect(res.status).toBe(307); // NextResponse.redirect default
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('rejects non-lisna scheme with 400 and no-store', async () => {
    const res = await GET(
      buildReq('http://x/api/auth/exchange-code/issue?app_callback=https://evil.com'),
    );
    expect(res.status).toBe(400);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('rejects callback containing fragment with 400', async () => {
    const res = await GET(
      buildReq('http://x/api/auth/exchange-code/issue?app_callback=lisna://callback%23frag'),
    );
    expect(res.status).toBe(400);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('rejects callback containing extra query param (?) with 400', async () => {
    const res = await GET(
      buildReq('http://x/api/auth/exchange-code/issue?app_callback=lisna://callback%3Fcode%3Devil'),
    );
    expect(res.status).toBe(400);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('rejects callback containing & with 400', async () => {
    const res = await GET(
      buildReq(
        'http://x/api/auth/exchange-code/issue?app_callback=lisna://callback%26injected%3D1',
      ),
    );
    expect(res.status).toBe(400);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('escapes </script> in the inline script block', async () => {
    (buildCallbackUrl as ReturnType<typeof vi.fn>).mockReturnValue(
      'lisna://callback</script><script>alert(1)</script>?code=x',
    );
    const res = await GET(
      buildReq('http://x/api/auth/exchange-code/issue?app_callback=lisna://callback'),
    );
    const body = await res.text();
    // The literal sequence </script><script> must NOT appear verbatim
    expect(body).not.toMatch(/<\/script><script>/i);
    // The < and > must be Unicode-escaped in the script context
    expect(body).toContain('\\u003c/script\\u003e');
  });

  it('escapes double-quote in the meta-refresh attribute', async () => {
    (buildCallbackUrl as ReturnType<typeof vi.fn>).mockReturnValue(
      'lisna://callback?code=x"onerror=alert(1)',
    );
    const res = await GET(
      buildReq('http://x/api/auth/exchange-code/issue?app_callback=lisna://callback'),
    );
    const body = await res.text();
    // Unescaped " would break out of the content="" attribute
    expect(body).not.toMatch(/url=lisna:\/\/callback\?code=x"/);
    expect(body).toContain('&quot;');
  });

  it('happy path returns 200 HTML with Cache-Control: no-store', async () => {
    const res = await GET(
      buildReq('http://x/api/auth/exchange-code/issue?app_callback=lisna://callback'),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Content-Type')).toMatch(/text\/html/);
    const body = await res.text();
    expect(body).toContain('lisna://callback?code=abc123');
  });
});
