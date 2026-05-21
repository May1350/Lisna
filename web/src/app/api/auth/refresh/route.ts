// web/src/app/api/auth/refresh/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { appDevices } from '@/db/schema';
import { eq, isNull, and } from 'drizzle-orm';

export async function POST(req: NextRequest) {
  const m = /^Bearer (.+)$/.exec(req.headers.get('authorization') ?? '');
  if (!m) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const result = await db
    .update(appDevices)
    .set({ lastSeenAt: new Date() })
    .where(and(eq(appDevices.deviceToken, m[1]), isNull(appDevices.revokedAt)))
    .returning({ id: appDevices.id });
  if (result.length === 0) return NextResponse.json({ error: 'invalid_or_revoked' }, { status: 401 });
  return NextResponse.json({ ok: true });
}
