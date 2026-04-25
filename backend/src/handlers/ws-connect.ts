import type { APIGatewayProxyHandler } from 'aws-lambda'
import { verifyJwt } from '../lib/auth.js'
import { query } from '../lib/db.js'
import { loadAppSecrets } from '../lib/env.js'

export const handler: APIGatewayProxyHandler = async (event) => {
  await loadAppSecrets()
  const token = event.queryStringParameters?.token
  const sessionId = event.queryStringParameters?.session_id
  if (!token || !sessionId) return { statusCode: 400, body: 'missing params' }
  try {
    const payload = await verifyJwt(token)
    // Verify session ownership: a user can only subscribe to their own sessions.
    // Without this check, anyone with a valid JWT could subscribe by guessing/leaking session IDs.
    const owned = await query<{ id: string }>(
      `SELECT id FROM sessions WHERE id = $1 AND user_id = $2`,
      [sessionId, payload.sub]
    )
    if (owned.length === 0) {
      return { statusCode: 403, body: 'forbidden' }
    }
    await query(
      `INSERT INTO ws_connections (connection_id, user_id, session_id) VALUES ($1, $2, $3)
       ON CONFLICT (connection_id) DO UPDATE SET session_id = EXCLUDED.session_id`,
      [event.requestContext.connectionId, payload.sub, sessionId]
    )
    return { statusCode: 200, body: 'ok' }
  } catch {
    return { statusCode: 401, body: 'unauthorized' }
  }
}
