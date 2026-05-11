import type { APIGatewayProxyHandlerV2 } from 'aws-lambda'
import { verifyJwt } from '../lib/auth.js'
import { sendToSession } from '../lib/ws-broadcast.js'
import { query } from '../lib/db.js'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { presignGet } from '../lib/s3-presigned.js'
import { loadAppSecrets } from '../lib/env.js'
import { createHash } from 'node:crypto'
// Body schema now lives in the shared workspace — see shared/src/index.ts.
import { streamSlideBodySchema as Body } from 'shared'

const s3 = new S3Client({})

interface SlideRow { ts: number; key: string; hash?: string }

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
  // SHA256 of the JPEG bytes — used as both the dedup key and the S3
  // object key. Identical re-captures (the user replaying a lecture)
  // produce the same hash, so the S3 PUT becomes naturally idempotent
  // and the DB-level dedup check below skips the duplicate row insert.
  const imgHash = createHash('sha256').update(buf).digest('hex')

  const urlHash = createHash('sha256').update(normalizeUrl(body.url)).digest('hex')

  // Upsert session AND read existing slides in a single round-trip.
  // RETURNING fires for both INSERT (slides defaults to []) and the
  // ON CONFLICT branch, so we always get the canonical slides array
  // back without a follow-up SELECT.
  const upserted = await query<{ id: string; slides: SlideRow[] | null }>(
    `INSERT INTO sessions (id, user_id, url_hash, url_original)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, url_hash) DO UPDATE SET updated_at = NOW()
     RETURNING id, slides`,
    [body.session_id, payload.sub, urlHash, body.url]
  )
  const sessionId = upserted[0].id

  // Dedup check, two-layer:
  //   1. SHA256 image hash — authoritative for identical re-captures
  //      (same JPEG bytes from the user replaying a lecture).
  //   2. Video-time fallback (±TS_DEDUP_TOLERANCE_SEC). Catches two
  //      cases hash-dedup misses:
  //        (a) legacy slides written before this handler started
  //            persisting `hash` — their row has no `hash` field, so
  //            a new replay's hash never matches them and the row
  //            keeps growing one entry per playback.
  //        (b) `canvas.toBlob` byte-different output for the same
  //            displayed frame (rare but observed across Chrome
  //            versions — JPEG encoder is not always deterministic
  //            for identical input pixels, especially on the
  //            baseline-emit path where the decode buffer may
  //            differ across capture sessions).
  // Both layers are SAFE in the strict sense — a 1 s tolerance is far
  // tighter than the typical slide dwell time (10 s+), so a true
  // distinct slide within 1 s of a prior one (very rare in lecture
  // material) is the only false-positive risk.
  const existing = upserted[0].slides ?? []
  const TS_DEDUP_TOLERANCE_SEC = 1
  const dup
    = existing.find(s => s.hash === imgHash)
    ?? existing.find(s => Math.abs(s.ts - body.ts) < TS_DEDUP_TOLERANCE_SEC)
  if (dup) {
    const presignedUrl = await presignGet(dup.key)
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, key: dup.key, url: presignedUrl, deduped: true }),
    }
  }

  // Novel capture — write to S3 with the hash-keyed path, then append
  // to the slides JSONB. The hash is persisted so subsequent re-watches
  // can dedup against it.
  const key = `slides/${payload.sub}/${sessionId}/${imgHash}.jpg`
  await s3.send(new PutObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: key,
    Body: buf,
    ContentType: 'image/jpeg',
  }))

  const slide: SlideRow = { ts: body.ts, key, hash: imgHash }
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
