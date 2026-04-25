import { query } from './db.js'

export const FREE_LIMIT_SECS = 30 * 60          // 30 min
export const PRO_LIMIT_SECS = 30 * 60 * 60      // 30 hours

export type Plan = 'free' | 'pro'

export function currentPeriod(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

function limitFor(plan: Plan): number {
  return plan === 'pro' ? PRO_LIMIT_SECS : FREE_LIMIT_SECS
}

export async function checkQuota(userId: string, plan: Plan): Promise<{
  allowed: boolean
  used: number
  limit: number
  remainingSecs: number
}> {
  const period = currentPeriod()
  const rows = await query<{ seconds_used: number }>(
    `SELECT seconds_used FROM quota_usage WHERE user_id = $1 AND period = $2`,
    [userId, period]
  )
  const used = rows[0]?.seconds_used ?? 0
  const limit = limitFor(plan)
  return { allowed: used < limit, used, limit, remainingSecs: Math.max(0, limit - used) }
}

export async function recordUsage(userId: string, seconds: number): Promise<void> {
  const period = currentPeriod()
  await query(
    `INSERT INTO quota_usage (user_id, period, seconds_used) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, period) DO UPDATE SET seconds_used = quota_usage.seconds_used + EXCLUDED.seconds_used`,
    [userId, period, seconds]
  )
}
