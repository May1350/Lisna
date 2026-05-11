import type { APIGatewayProxyHandlerV2 } from 'aws-lambda'
import { verifyJwt } from '../lib/auth.js'
import { query } from '../lib/db.js'
import { loadAppSecrets } from '../lib/env.js'
import { checkQuota, type Plan } from '../lib/quota.js'

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  await loadAppSecrets()
  const auth = event.headers.authorization || event.headers.Authorization
  if (!auth?.startsWith('Bearer ')) {
    // Diagnostic: surface why this rejected. Catch path-2 (verifyJwt
    // throw) and path-1 (no Bearer) used to be indistinguishable in
    // CloudWatch — both returned plain 401. This split is the bare
    // minimum needed to bisect login regressions without re-deploying.
    // eslint-disable-next-line no-console
    console.warn('[auth-me] 401 unauthorized: no Bearer header', {
      hasAuth: !!auth,
      authPrefix: auth?.slice(0, 16),
      hostHeader: event.headers.host,
    })
    return { statusCode: 401, body: JSON.stringify({ error: 'unauthorized' }) }
  }
  try {
    const payload = await verifyJwt(auth.slice(7))
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
  } catch (e) {
    // Diagnostic (same rationale as the path-1 log above): record the
    // exact verifyJwt failure reason so JWT_SECRET drift, expired
    // tokens, malformed tokens, and DB/quota throws inside the try
    // are distinguishable in CloudWatch.
    // eslint-disable-next-line no-console
    console.warn('[auth-me] 401 invalid: verifyJwt or downstream threw', {
      err: e instanceof Error ? e.message : String(e),
      tokenLen: auth.slice(7).length,
    })
    return { statusCode: 401, body: JSON.stringify({ error: 'invalid token' }) }
  }
}
