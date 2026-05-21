import { randomBytes } from 'node:crypto';
import { db } from './db';
import { appExchangeCodes, appDevices } from '@/db/schema';
import { eq, and, isNull, gt } from 'drizzle-orm';

const EXCHANGE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const DEVICE_TOKEN_TTL_DAYS = 90;

export function generateExchangeCode(): string {
  return randomBytes(32).toString('hex');
}

export function buildCallbackUrl(callback: string, code: string): string {
  if (!callback.startsWith('lisna://')) {
    throw new Error(`Invalid app callback scheme: ${callback}`);
  }
  const sep = callback.includes('?') ? '&' : '?';
  return `${callback}${sep}code=${encodeURIComponent(code)}`;
}

export async function issueExchangeCode(userId: string): Promise<string> {
  const code = generateExchangeCode();
  const expiresAt = new Date(Date.now() + EXCHANGE_TTL_MS);
  await db.insert(appExchangeCodes).values({ code, userId, expiresAt });
  return code;
}

export async function redeemExchangeCode(code: string): Promise<{ userId: string; deviceToken: string }> {
  // Atomic: mark consumed only if still unconsumed AND not expired.
  const now = new Date();
  const updated = await db
    .update(appExchangeCodes)
    .set({ consumedAt: now })
    .where(
      and(
        eq(appExchangeCodes.code, code),
        isNull(appExchangeCodes.consumedAt),
        gt(appExchangeCodes.expiresAt, now),
      ),
    )
    .returning({ userId: appExchangeCodes.userId });

  if (updated.length === 0) {
    throw new Error('exchange code invalid or already consumed');
  }
  const { userId } = updated[0];

  // Create a device record + token
  const deviceToken = randomBytes(48).toString('base64url');
  await db.insert(appDevices).values({
    userId,
    deviceToken,
    name: 'Mac', // TODO: send a device name from the desktop client
  });
  return { userId, deviceToken };
}

export const DEVICE_TOKEN_TTL_DAYS_EXPORT = DEVICE_TOKEN_TTL_DAYS;
