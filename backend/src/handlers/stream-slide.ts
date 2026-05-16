import { sendToSession } from '../lib/ws-broadcast.js'
import { query } from '../lib/db.js'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { presignGet } from '../lib/s3-presigned.js'
import { createHash } from 'node:crypto'
// Body schema now lives in the shared workspace — see shared/src/index.ts.
import { streamSlideBodySchema as Body } from 'shared'
import { withAuth } from '../lib/with-auth.js'

const s3 = new S3Client({})

interface SlideRow { ts: number; key: string; hash?: string }

function normalizeUrl(u: string): string {
  const url = new URL(u)
  url.hash = ''
  return url.toString()
}

export const handler = withAuth('stream-slide', async (event, payload) => {
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
  //      (same JPEG bytes from the user replaying a lecture). This is
  //      the path EVERY new row takes.
  //   2. Video-time fallback (±TS_DEDUP_TOLERANCE_SEC), gated by `!s.hash`
  //      so it ONLY applies to LEGACY rows written before this handler
  //      started persisting `hash`. Those rows can never hash-match a
  //      new capture, so without this fallback a re-watch would grow
  //      one extra row per legacy slide every time. Newly-written
  //      rows always carry `hash`, so they fall through to layer 1
  //      and are unaffected.
  //
  // PRIOR BUG (fixed 2026-05-13): layer 2 was unconditional, which
  // false-positive deduped genuinely new slides whose ts happened to
  // land within 1 s of a prior session's capture. Re-watch flow lost
  // ~30-70% of newly-captured slides to that.
  //
  // The case 2 was originally designed to also cover (was: layer 2b)
  // `canvas.toBlob` byte-different output for the same displayed frame
  // (rare; JPEG encoder is not strictly deterministic across Chrome
  // versions / decode-buffer states). Those slip through now and
  // become duplicate rows, but downstream rendering tolerates that
  // (visually-identical slides at near-identical ts cluster together
  // and don't hurt the outline). The re-watch correctness win is the
  // far bigger lever, so accepting that tradeoff.
  const existing = upserted[0].slides ?? []
  const TS_DEDUP_TOLERANCE_SEC = 1
  const dup
    = existing.find(s => s.hash === imgHash)
    ?? existing.find(s => !s.hash && Math.abs(s.ts - body.ts) < TS_DEDUP_TOLERANCE_SEC)
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
})
