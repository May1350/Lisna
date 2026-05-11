import { query } from '../lib/db.js'
import { checkQuota, type Plan } from '../lib/quota.js'
import { withAuth } from '../lib/with-auth.js'

export const handler = withAuth('auth-me', async (_event, payload) => {
  // Alias display_name → name in the SQL so the response shape matches
  // the extension's User type (`{id, email, name?, plan}`). Without
  // this, the side-panel avatar + Options identity card would render
  // `user.name` as undefined for /v1/auth/me payloads — the Pro user
  // would see a placeholder initial instead of their actual name.
  const rows = await query<{ id: string; email: string; name: string; plan: Plan }>(
    `SELECT id, email, display_name AS name, plan FROM users WHERE id = $1`, [payload.sub]
  )
  if (rows.length === 0) {
    return { statusCode: 404, body: JSON.stringify({ error: 'user not found' }) }
  }
  const user = rows[0]

  // Embed quota in the same response so the Options page can render
  // usage without a second round-trip. The frontend's QuotaSnapshot
  // shape (used_secs, limit_secs, remaining_secs, percent_used, plan)
  // is consumed by PlanSection — without this field PlanSection
  // crashes on `quota.used_secs` and React unmounts the whole tree
  // (white-screen-after-5s symptom).
  const q = await checkQuota(user.id, user.plan)
  const quota = {
    used_secs: q.used,
    limit_secs: q.limit,
    remaining_secs: q.remainingSecs,
    percent_used: Math.min(100, Math.round((q.used / Math.max(1, q.limit)) * 100)),
    plan: user.plan,
    // Distinguishes the 2-hour one-time trial budget from the
    // user's plan-tier monthly quota. The frontend uses this to
    // (a) badge the header "Trial · 1:23 남음" instead of "Free",
    // (b) show the trial-end decision modal at 100% (Pro 가입
    // (원클릭) vs 가입 안함) instead of the regular Pro upsell.
    trial_active: q.trialActive,
  }

  // Has the user ever started a trial? Decides whether the
  // QuotaExhaustedIdle card shows the "2시간 무료 받기" CTA (never
  // tried) or the regular "Pro 가입" CTA (already tried, declined
  // or converted, can't trial again).
  const trialRows = await query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM trial_grants WHERE user_id = $1) AS exists`, [user.id],
  )
  const trial_used = trialRows[0]?.exists === true

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: { ...user, trial_used }, quota }),
  }
})
