import type { APIGatewayProxyHandlerV2 } from 'aws-lambda'
import { verifyJwt } from '../lib/auth.js'
import { query } from '../lib/db.js'
import { loadAppSecrets } from '../lib/env.js'

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  await loadAppSecrets()
  const auth = event.headers.authorization || event.headers.Authorization
  if (!auth?.startsWith('Bearer ')) return { statusCode: 401, body: 'unauthorized' }
  let payload
  try { payload = await verifyJwt(auth.slice(7)) }
  catch { return { statusCode: 401, body: 'invalid token' } }

  const id = event.pathParameters?.id
  if (!id) return { statusCode: 400, body: 'missing id' }
  // RETURNING id distinguishes "actually deleted (owned, existed, status
  // wasn't already 'deleted')" from "no-op (foreign uuid / nonexistent /
  // already deleted)". Both non-deleted cases collapse to 404 — we
  // intentionally do NOT distinguish them so a probe can't tell whether
  // a uuid belongs to another user. Matches the audit's defense-in-depth
  // recommendation and gives the frontend a reliable "really deleted"
  // signal vs "we did nothing" — the latter is safe to ignore client-side.
  const r = await query<{ id: string }>(
    `UPDATE sessions SET status = 'deleted'
       WHERE id = $1 AND user_id = $2 AND status != 'deleted'
       RETURNING id`,
    [id, payload.sub],
  )
  if (r.length === 0) {
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'not_found' }),
    }
  }
  return { statusCode: 204, body: '' }
}
