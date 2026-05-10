import { query } from './db.js'

export const FREE_LIMIT_SECS = 30 * 60          // 30 min
export const PRO_LIMIT_SECS = 30 * 60 * 60      // 30 hours
export const TRIAL_LIMIT_SECS = 2 * 60 * 60     // 2 hours (one-time grant)

export type Plan = 'free' | 'pro'

export function currentPeriod(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

function limitFor(plan: Plan): number {
  return plan === 'pro' ? PRO_LIMIT_SECS : FREE_LIMIT_SECS
}

/**
 * "Active" = card-setup completed, not declined, not converted to Pro,
 * not expired (1-month deadline), and still has remaining seconds.
 * checkQuota uses these values to override the plan's normal limit.
 */
export interface ActiveTrial {
  granted_at: Date
  expires_at: Date
  used_secs: number
  limit_secs: number
}

export async function getActiveTrial(userId: string): Promise<ActiveTrial | null> {
  const rows = await query<ActiveTrial>(
    `SELECT granted_at, expires_at, used_secs, limit_secs
       FROM trial_grants
      WHERE user_id = $1
        AND declined_at IS NULL
        AND converted_at IS NULL
        AND expires_at > NOW()
        AND used_secs < limit_secs`,
    [userId],
  )
  return rows[0] ?? null
}

export async function checkQuota(userId: string, plan: Plan): Promise<{
  allowed: boolean
  used: number
  limit: number
  remainingSecs: number
  /** True when the (used/limit) figures are coming from an active
   *  trial grant rather than the plan's monthly bucket. The
   *  frontend can surface this distinctly ("Trial · 1:23 남음"
   *  instead of "Free · 5분"). */
  trialActive: boolean
}> {
  // Pro users always use their plan's monthly quota — they don't
  // have access to the trial flow (they're already paying), and
  // even if a row exists from before they converted we ignore it.
  if (plan !== 'pro') {
    const trial = await getActiveTrial(userId)
    if (trial) {
      return {
        allowed: trial.used_secs < trial.limit_secs,
        used: trial.used_secs,
        limit: trial.limit_secs,
        remainingSecs: Math.max(0, trial.limit_secs - trial.used_secs),
        trialActive: true,
      }
    }
  }
  const period = currentPeriod()
  const rows = await query<{ seconds_used: number }>(
    `SELECT seconds_used FROM quota_usage WHERE user_id = $1 AND period = $2`,
    [userId, period],
  )
  const used = rows[0]?.seconds_used ?? 0
  const limit = limitFor(plan)
  return {
    allowed: used < limit,
    used,
    limit,
    remainingSecs: Math.max(0, limit - used),
    trialActive: false,
  }
}

export async function recordUsage(userId: string, plan: Plan, seconds: number): Promise<void> {
  // Mirror the read path: if the user has an active trial, increment
  // its counter. Otherwise increment the monthly quota_usage row.
  // We re-read inside this function (not passed in) so the caller
  // doesn't have to coordinate state — recordUsage and checkQuota
  // can be called independently and stay consistent.
  if (plan !== 'pro') {
    const trial = await getActiveTrial(userId)
    if (trial) {
      await query(
        `UPDATE trial_grants
            SET used_secs = used_secs + $2
          WHERE user_id = $1
            AND declined_at IS NULL
            AND converted_at IS NULL
            AND expires_at > NOW()`,
        [userId, seconds],
      )
      return
    }
  }
  const period = currentPeriod()
  await query(
    `INSERT INTO quota_usage (user_id, period, seconds_used) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, period) DO UPDATE SET seconds_used = quota_usage.seconds_used + EXCLUDED.seconds_used`,
    [userId, period, seconds],
  )
}
