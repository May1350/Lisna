import type { APIGatewayProxyHandlerV2 } from 'aws-lambda'
import { verifyJwt } from '../lib/auth.js'
import { transcribeChunk } from '../lib/stt.js'
import { curateOutline, type Outline } from '../lib/curator.js'
import { checkQuota, recordUsage } from '../lib/quota.js'
import { sendToSession } from '../lib/ws-broadcast.js'
import { query } from '../lib/db.js'
import { loadAppSecrets } from '../lib/env.js'
import { isWarmup, warmupResponse } from '../lib/warmup.js'
import { createHash } from 'node:crypto'
import { z } from 'zod'

const Body = z.object({
  session_id: z.string().uuid(),
  url: z.string().url(),
  start_time_sec: z.number().nonnegative(),
  duration_sec: z.number().positive(),
  audio_b64: z.string().min(1),
  mime: z.string(),
})

interface TranscriptEntry { ts: number; text: string }

// Curator runs every CURATOR_EVERY_N_CHUNKS chunks. With 10 s chunks that's
// roughly every 30 s of lecture audio. Tighter = more responsive outline,
// looser = fewer LLM calls. Keep the per-chunk live transcript broadcast as
// the "instant feedback" track regardless of this cadence.
const CURATOR_EVERY_N_CHUNKS = 3

function normalizeUrl(u: string): string {
  const url = new URL(u)
  url.hash = ''
  return url.toString()
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  if (isWarmup(event)) return warmupResponse()
  await loadAppSecrets()
  const auth = event.headers.authorization || event.headers.Authorization
  if (!auth?.startsWith('Bearer ')) return { statusCode: 401, body: 'unauthorized' }

  let payload
  try { payload = await verifyJwt(auth.slice(7)) }
  catch { return { statusCode: 401, body: 'invalid token' } }

  const body = Body.parse(JSON.parse(event.body || '{}'))
  const userPlan = payload.plan
  const quota = await checkQuota(payload.sub, userPlan)
  if (!quota.allowed) {
    return {
      statusCode: 402,
      body: JSON.stringify({ error: 'quota_exceeded', remaining_secs: 0 }),
    }
  }

  const audioBuf = Buffer.from(body.audio_b64, 'base64').buffer

  // ── 1. UPSERT SESSION ROW (always, even on STT/curator failure) ──────────
  // The client adopts the canonical session_id on the first response and
  // uses it to connect WebSocket. We always return 200 with that id even on
  // downstream errors so the modal can still hydrate and listen to WS.
  const urlHash = createHash('sha256').update(normalizeUrl(body.url)).digest('hex')
  const upserted = await query<{ id: string }>(
    `INSERT INTO sessions (id, user_id, url_hash, url_original)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, url_hash) DO UPDATE SET updated_at = NOW()
     RETURNING id`,
    [body.session_id, payload.sub, urlHash, body.url]
  )
  const sessionId = upserted[0].id

  // ── 2. STT (best-effort) ────────────────────────────────────────────────
  let transcriptText = ''
  let chunkError: string | undefined
  try {
    const transcript = await transcribeChunk(audioBuf, body.mime)
    transcriptText = transcript.text.trim()
  } catch (e) {
    chunkError = 'stt_failed'
    // eslint-disable-next-line no-console
    console.warn('[stream-audio] STT failed; skipping chunk:', e instanceof Error ? e.message : e)
  }

  // Nothing usable from STT — nothing to do downstream. Still return 200 so
  // the client can adopt the session id.
  if (transcriptText.length === 0) {
    return ok(sessionId, { chunk_error: chunkError ?? 'empty_transcript' })
  }

  // ── 3. Append transcript to session log + live broadcast ────────────────
  // Append-only JSONB array. The curator reads the full array on each run.
  // Live transcript broadcast goes out the moment STT finishes, before the
  // (potentially expensive) curator runs, so the user sees text in ~1 s.
  const transcriptEntry: TranscriptEntry = {
    ts: Math.round(body.start_time_sec),
    text: transcriptText,
  }

  void sendToSession(sessionId, {
    type: 'transcript_chunk',
    ts: transcriptEntry.ts,
    text: transcriptEntry.text,
  }).catch(e => console.warn('[stream-audio] live transcript broadcast failed:', e))

  await query(
    `UPDATE sessions
       SET transcripts = COALESCE(transcripts, '[]'::jsonb) || $1::jsonb,
           updated_at  = NOW()
     WHERE id = $2`,
    [JSON.stringify([transcriptEntry]), sessionId],
  )

  // ── 4. Curator (every N chunks; not every chunk) ────────────────────────
  // Read the current transcripts + outline, regenerate the outline. This is
  // expensive (~1-3 s with the full transcript so far), so we throttle by
  // chunk count: only run it every CURATOR_EVERY_N_CHUNKS chunks.
  const sess = await query<{ transcripts: TranscriptEntry[]; outline: Outline | null }>(
    `SELECT transcripts, outline FROM sessions WHERE id = $1`,
    [sessionId],
  )
  const transcripts = sess[0]?.transcripts ?? []
  const previousOutline = sess[0]?.outline ?? null
  const shouldCurate = transcripts.length % CURATOR_EVERY_N_CHUNKS === 0
    || previousOutline === null  // first time we have any transcript at all

  if (shouldCurate) {
    try {
      const outline = await curateOutline({
        bucketedTranscript: transcripts,
        previousOutline,
      })
      await query(
        `UPDATE sessions SET outline = $1::jsonb, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify(outline), sessionId],
      )
      void sendToSession(sessionId, {
        type: 'outline_updated',
        outline,
      }).catch(e => console.warn('[stream-audio] outline broadcast failed:', e))
    } catch (e) {
      chunkError = chunkError ?? 'curator_failed'
      // eslint-disable-next-line no-console
      console.warn('[stream-audio] curator failed; outline unchanged:', e instanceof Error ? e.message : e)
    }
  }

  await recordUsage(payload.sub, Math.ceil(body.duration_sec))

  return ok(sessionId, {
    transcript_preview: transcriptText.slice(0, 80),
    transcripts_count: transcripts.length,
    curated: shouldCurate,
    ...(chunkError ? { chunk_error: chunkError } : {}),
  })
}

function ok(sessionId: string, extra: Record<string, unknown>) {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, ...extra }),
  }
}
