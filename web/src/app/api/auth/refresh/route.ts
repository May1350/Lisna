// web/src/app/api/auth/refresh/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { appDevices } from '@/db/schema';
import { eq, isNull, and, gt } from 'drizzle-orm';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days, mirrors redeem endpoint's advertised expiresAt

export async function POST(req: NextRequest) {
  const m = /^Bearer (.+)$/.exec(req.headers.get('authorization') ?? '');
  if (!m) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  const result = await db
    .update(appDevices)
    .set({ lastSeenAt: new Date() })
    .where(and(
      eq(appDevices.deviceToken, m[1]),
      isNull(appDevices.revokedAt),
      gt(appDevices.createdAt, new Date(Date.now() - TTL_MS)),
    ))
    .returning({ id: appDevices.id });
  if (result.length === 0) return NextResponse.json({ error: 'invalid_or_revoked' }, { status: 401, headers: NO_STORE });
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
