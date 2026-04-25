import type { APIGatewayProxyHandlerV2 } from 'aws-lambda'
import { verifyJwt } from '../lib/auth.js'
import { sendToSession } from '../lib/ws-broadcast.js'
import { query } from '../lib/db.js'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { loadAppSecrets } from '../lib/env.js'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'

const s3 = new S3Client({})

const Body = z.object({
  session_id: z.string().uuid(),
  ts: z.number().nonnegative(),
  image_b64: z.string().min(1),
  mime: z.literal('image/jpeg'),
})

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

  const slide = { ts: body.ts, key }
  await query(
    `UPDATE sessions SET slides = slides || $1::jsonb, updated_at = NOW() WHERE id = $2 AND user_id = $3`,
    [JSON.stringify([slide]), body.session_id, payload.sub]
  )

  await sendToSession(body.session_id, { type: 'slide_chunk', slide })

  return { statusCode: 200, body: JSON.stringify({ key }) }
}
