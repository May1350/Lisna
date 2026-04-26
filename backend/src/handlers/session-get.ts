import type { APIGatewayProxyHandlerV2 } from 'aws-lambda'
import { verifyJwt } from '../lib/auth.js'
import { query } from '../lib/db.js'
import { loadAppSecrets } from '../lib/env.js'
import { presignGet } from '../lib/s3-presigned.js'
import { createHash } from 'node:crypto'

function normalizeUrl(u: string): string {
  const url = new URL(u); url.hash = ''; return url.toString()
}

interface SlideRow { ts: number; key: string }

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  await loadAppSecrets()
  const auth = event.headers.authorization || event.headers.Authorization
  if (!auth?.startsWith('Bearer ')) return { statusCode: 401, body: 'unauthorized' }
  let payload
  try { payload = await verifyJwt(auth.slice(7)) }
  catch { return { statusCode: 401, body: 'invalid token' } }

  const url = event.queryStringParameters?.url
  if (!url) return { statusCode: 400, body: 'missing url' }
  const urlHash = createHash('sha256').update(normalizeUrl(url)).digest('hex')

  const rows = await query<{ id: string; notes: unknown; slides: SlideRow[]; status: string; created_at: string }>(
    `SELECT id, notes, slides, status, created_at FROM sessions
     WHERE user_id = $1 AND url_hash = $2 AND status != 'deleted'`,
    [payload.sub, urlHash]
  )
  const session = rows[0] ?? null
  if (session && Array.isArray(session.slides)) {
    session.slides = await Promise.all(
      session.slides.map(async (s) => ({ ...s, url: await presignGet(s.key) }))
    ) as SlideRow[] & { url: string }[]
  }
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session }),
  }
}
