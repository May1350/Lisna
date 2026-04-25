import type { APIGatewayProxyHandlerV2 } from 'aws-lambda'
import { verifyGoogleIdToken, signJwt } from '../lib/auth.js'
import { query } from '../lib/db.js'
import { loadAppSecrets } from '../lib/env.js'
import { z } from 'zod'

const Body = z.object({ id_token: z.string().min(1) })

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    await loadAppSecrets()
    const { id_token } = Body.parse(JSON.parse(event.body || '{}'))
    const g = await verifyGoogleIdToken(id_token)

    const existing = await query<{ id: string; plan: 'free' | 'pro' }>(
      `SELECT id, plan FROM users WHERE google_sub = $1`, [g.sub]
    )
    let userId: string
    let plan: 'free' | 'pro' = 'free'
    if (existing.length > 0) {
      userId = existing[0].id
      plan = existing[0].plan
    } else {
      const inserted = await query<{ id: string }>(
        `INSERT INTO users (google_sub, email, display_name) VALUES ($1, $2, $3) RETURNING id`,
        [g.sub, g.email, g.name ?? null]
      )
      userId = inserted[0].id
    }

    const token = await signJwt({ sub: userId, plan }, 60 * 60 * 24 * 7) // 7 days
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, user: { id: userId, email: g.email, name: g.name, plan } }),
    }
  } catch (e) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: e instanceof Error ? e.message : 'unknown' }),
    }
  }
}
