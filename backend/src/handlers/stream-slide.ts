import { withAuth } from '../lib/auth.js'
import { sendToSession } from '../lib/ws-broadcast.js'
import { query } from '../lib/db.js'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { presignGet } from '../lib/s3-presigned.js'
import { z } from 'zod'
import { randomUUID, createHash } from 'node:crypto'

const s3 = new S3Client({})

// Size + count caps. Real slide thumbnails from SlideDetector.canvas
// (320×180 JPEG q=0.85) come in around 8-25 KB. 5 MB raw (≈ 6.7 MB
// base64) gives plenty of headroom for legitimate hi-DPI captures
// while making it trivially impossible to spam-upload large files.
// Per-session cap of 500 slides covers a 4-hour lecture at one slide
// every 30 s and bounds total S3 spend per user.
const MAX_IMAGE_B64_LEN = 6_700_000
const MAX_SLIDES_PER_SESSION = 500

// Dedup window for replay scenarios. When the user re-plays the same
// lecture (or scrubs back through it) the slide-detector emits the
// same slide changes again, and the backend was naively appending
// each emission as a new slide — producing 2-3 visually identical
// images at near-identical timestamps in the same session. The
// curator + the modal's slide strip both then double-count them.
//
// 3 s tolerance: the slide-detector's MIN_GAP_SEC is also 3 s within
// a single capture run, so any two genuinely-different slides are
// at least 3 s apart. Using the same window for cross-run dedup
// means we never falsely drop a real slide change.
const DEDUP_WINDOW_SEC = 3

const Body = z.object({
  session_id: z.string().uuid(),
  url: z.string().url(),
  ts: z.number().nonnegative(),
  image_b64: z.string().min(1).max(MAX_IMAGE_B64_LEN),
  mime: z.literal('image/jpeg'),
})

function normalizeUrl(u: string): string {
  const url = new URL(u)
  url.hash = ''
  return url.toString()
}

export const handler = withAuth(async (event, payload) => {
  const body = Body.parse(JSON.parse(event.body || '{}'))
  const buf = Buffer.from(body.image_b64, 'base64')

  // upsert session row; capture canonical id so subsequent UPDATE targets the right row.
  // Also pull back the existing slides array so we can dedup against it
  // BEFORE paying for an S3 PUT (replay → same timestamps coming in).
  interface ExistingSlide { ts: number; key: string }
  const urlHash = createHash('sha256').update(normalizeUrl(body.url)).digest('hex')
  const upserted = await query<{ id: string; slide_count: number; slides: ExistingSlide[] | null }>(
    `INSERT INTO sessions (id, user_id, url_hash, url_original)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, url_hash) DO UPDATE SET updated_at = NOW()
     RETURNING id,
               COALESCE(jsonb_array_length(slides), 0) AS slide_count,
               slides AS slides`,
    [body.session_id, payload.sub, urlHash, body.url]
  )
  const sessionId = upserted[0].id
  const slideCount = upserted[0].slide_count
  const existingSlides = upserted[0].slides ?? []

  // Replay-dedup: if a slide already exists in this session within
  // DEDUP_WINDOW_SEC of the requested ts, skip the S3 PUT + DB append
  // entirely and return the existing slide's URL. Catches the case
  // where the user replays the same lecture and the slide-detector
  // re-emits at the same timestamps. No WS broadcast on dedup
  // because the slide is already in the modal's state from the
  // session-get hydration on mount.
  const dup = existingSlides.find(s => Math.abs(s.ts - body.ts) < DEDUP_WINDOW_SEC)
  if (dup) {
    const presignedUrl = await presignGet(dup.key)
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        key: dup.key,
        url: presignedUrl,
        deduped: true,
        existing_ts: dup.ts,
      }),
    }
  }

  // Per-session slide cap. Drops the request BEFORE we pay for an S3
  // PUT — important because S3 is what would actually scale the cost
  // up under abuse, not the JSONB append.
  if (slideCount >= MAX_SLIDES_PER_SESSION) {
    return {
      statusCode: 413,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'slide_limit_reached',
        limit: MAX_SLIDES_PER_SESSION,
        message: `Per-session slide cap (${MAX_SLIDES_PER_SESSION}) reached. Older slides remain accessible.`,
      }),
    }
  }

  const key = `slides/${payload.sub}/${body.session_id}/${randomUUID()}.jpg`
  await s3.send(new PutObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: key,
    Body: buf,
    ContentType: 'image/jpeg',
  }))

  const slide = { ts: body.ts, key }
  await query(
    `UPDATE sessions
       SET slides = COALESCE(slides, '[]'::jsonb) || $1::jsonb,
           updated_at = NOW()
     WHERE id = $2 AND user_id = $3`,
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
