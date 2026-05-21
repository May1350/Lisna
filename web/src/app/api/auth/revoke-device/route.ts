// web/src/app/api/auth/revoke-device/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { appDevices } from '@/db/schema';
import { eq, and } from 'drizzle-orm';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({})) as { id?: string };
  if (!body.id) return NextResponse.json({ error: 'missing_id' }, { status: 400 });

  const result = await db
    .update(appDevices)
    .set({ revokedAt: new Date() })
    .where(and(eq(appDevices.id, body.id), eq(appDevices.userId, session.user.id)))
    .returning({ id: appDevices.id });
  if (result.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ id: result[0].id });
}
