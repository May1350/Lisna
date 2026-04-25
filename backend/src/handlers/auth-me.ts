import type { APIGatewayProxyHandlerV2 } from 'aws-lambda'
import { verifyJwt } from '../lib/auth.js'
import { query } from '../lib/db.js'
import { loadAppSecrets } from '../lib/env.js'

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  await loadAppSecrets()
  const auth = event.headers.authorization || event.headers.Authorization
  if (!auth?.startsWith('Bearer ')) {
    return { statusCode: 401, body: JSON.stringify({ error: 'unauthorized' }) }
  }
  try {
    const payload = await verifyJwt(auth.slice(7))
    const rows = await query<{ id: string; email: string; display_name: string; plan: string }>(
      `SELECT id, email, display_name, plan FROM users WHERE id = $1`, [payload.sub]
    )
    if (rows.length === 0) {
      return { statusCode: 404, body: JSON.stringify({ error: 'user not found' }) }
    }
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: rows[0] }),
    }
  } catch {
    return { statusCode: 401, body: JSON.stringify({ error: 'invalid token' }) }
  }
}
