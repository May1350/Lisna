import { withAuth } from '../lib/auth.js'
import { query } from '../lib/db.js'
import { checkQuota } from '../lib/quota.js'

export const handler = withAuth(async (_event, payload) => {
  const rows = await query<{ id: string; email: string; display_name: string; plan: 'free' | 'pro' }>(
    `SELECT id, email, display_name, plan FROM users WHERE id = $1`,
    [payload.sub],
  )
  if (rows.length === 0) {
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'user not found' }),
    }
  }
  const user = rows[0]

  // Embed quota in the same response so the Options page (and any
  // future "current plan" surface) can render usage without a
  // second round-trip. checkQuota is a single SELECT — cheap.
  const q = await checkQuota(user.id, user.plan)
  const quota = {
    used_secs: q.used,
    limit_secs: q.limit,
    remaining_secs: q.remainingSecs,
    percent_used: Math.min(100, Math.round((q.used / Math.max(1, q.limit)) * 100)),
    plan: user.plan,
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user, quota }),
  }
})
