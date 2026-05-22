import { NextResponse, type NextRequest } from 'next/server';
import { redeemExchangeCode, DEVICE_TOKEN_TTL_DAYS_EXPORT } from '@/lib/app-auth';

export async function POST(req: NextRequest) {
  let body: { code?: string; name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  const code = body.code?.trim();
  if (!code) {
    return NextResponse.json({ error: 'missing_code' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  // 100-char defensive clamp on a `text`-typed column. `os.hostname()`
  // is realistically <= 64 chars on macOS, but we don't trust client
  // input. `undefined` falls through to the 'Mac' default in app-auth.ts.
  const name = typeof body.name === 'string' ? body.name.slice(0, 100) : undefined;
  try {
    const { userId, deviceToken } = await redeemExchangeCode(code, name);
    const expiresAt = new Date(Date.now() + DEVICE_TOKEN_TTL_DAYS_EXPORT * 24 * 60 * 60 * 1000).toISOString();
    return NextResponse.json(
      { token: deviceToken, userId, expiresAt },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return NextResponse.json({ error: 'invalid_or_consumed' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }
}
