import { withAuth } from '../lib/auth.js'
import { query } from '../lib/db.js'

export const handler = withAuth(async (event, payload) => {
  const id = event.pathParameters?.id
  if (!id) return { statusCode: 400, body: 'missing id' }
  // Soft-delete the session, scoped to the calling user. The previous
  // version returned 204 even when the row didn't exist or belonged to
  // another user — opaque to clients trying to detect bad ids. We now
  // check rowCount and return 404 when no row matched, which matches
  // typical REST conventions and helps clients surface a real error.
  const result = await query<{ id: string }>(
    `UPDATE sessions
        SET status = 'deleted'
      WHERE id = $1 AND user_id = $2
      RETURNING id`,
    [id, payload.sub],
  )
  if (result.length === 0) {
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'session not found' }),
    }
  }
  return { statusCode: 204, body: '' }
})
