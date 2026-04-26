import type { APIGatewayProxyHandlerV2 } from 'aws-lambda'
import { verifyJwt } from '../lib/auth.js'
import { sendToSession } from '../lib/ws-broadcast.js'
import { query } from '../lib/db.js'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { presignGet } from '../lib/s3-presigned.js'
import { loadAppSecrets } from '../lib/env.js'
import { z } from 'zod'
import { randomUUID, createHash } from 'node:crypto'

const s3 = new S3Client({})

const Body = z.object({
  session_id: z.string().uuid(),
  url: z.string().url(),
  ts: z.number().nonnegative(),
  image_b64: z.string().min(1),
  mime: z.literal('image/jpeg'),
})

function normalizeUrl(u: string): string {
  const url = new URL(u)
  url.hash = ''
  return url.toString()
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  await loadAppSecrets()
  const auth = event.headers.authorization || event.headers.Authorization
  if (!auth?.startsWith('Bearer ')) return { statusCode: 401, body: 'unauthorized' }
  let payload
  try { payload = await verifyJwt(auth.slice(7)) }
  catch { return { statusCode: 401, body: 'invalid token' } }

  const body = Body.parse(JSON.parse(event.body || '{}'))
  const buf = Buffer.from(body.image_b64, 'base64')
  const key = `slides/${payload.sub}/${body.session_id}/${randomUUID()}.jpg`
  await s3.send(new PutObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: key,
    Body: buf,
    ContentType: 'image/jpeg',
  }))

  const urlHash = createHash('sha256').update(normalizeUrl(body.url)).digest('hex')

  // upsert session row; capture canonical id so subsequent UPDATE targets the right row
  const upserted = await query<{ id: string }>(
    `INSERT INTO sessions (id, user_id, url_hash, url_original)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, url_hash) DO UPDATE SET updated_at = NOW()
     RETURNING id`,
    [body.session_id, payload.sub, urlHash, body.url]
  )
  const sessionId = upserted[0].id

  const slide = { ts: body.ts, key }
  await query(
    `UPDATE sessions SET slides = slides || $1::jsonb, updated_at = NOW() WHERE id = $2 AND user_id = $3`,
    [JSON.stringify([slide]), sessionId, payload.sub]
  )

  const presignedUrl = await presignGet(key)
  await sendToSession(sessionId, {
    type: 'slide_chunk',
    slide: { ts: body.ts, key, url: presignedUrl },
  })

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, key, url: presignedUrl }),
  }
}
