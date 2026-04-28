import type { APIGatewayProxyHandlerV2 } from 'aws-lambda'
import { verifyJwt } from '../lib/auth.js'
import { transcribeChunk } from '../lib/stt.js'
import { summarizeChunk } from '../lib/llm.js'
import { checkQuota, recordUsage } from '../lib/quota.js'
import { sendToSession } from '../lib/ws-broadcast.js'
import { query } from '../lib/db.js'
import { loadAppSecrets } from '../lib/env.js'
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
  const userPlan = payload.plan
  const quota = await checkQuota(payload.sub, userPlan)
  if (!quota.allowed) {
    return {
      statusCode: 402,
      body: JSON.stringify({ error: 'quota_exceeded', remaining_secs: 0 }),
    }
  }

  const audioBuf = Buffer.from(body.audio_b64, 'base64').buffer

  // ── 1. UPSERT SESSION ROW (always, even on STT/LLM failure) ──────────────
  // The client adopts the canonical session_id on the first response and
  // uses it to connect WebSocket. If we 5xx on every transient STT/LLM
  // failure, the client never adopts a session and the modal stays empty
  // forever even after Gemini recovers. So we ALWAYS return 200 with the
  // canonical session_id; STT/LLM failures just produce { added: 0 }.
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
    transcriptText = transcript.text
  } catch (e) {
    chunkError = 'stt_failed'
    // eslint-disable-next-line no-console
    console.warn('[stream-audio] STT failed; skipping chunk:', e instanceof Error ? e.message : e)
  }

  // ── 3. SUMMARY (best-effort, only if we have transcript text) ───────────
  let notes: { ts: number; text: string; important: boolean }[] = []
  if (transcriptText.trim().length > 0) {
    const sessRow = await query<{ notes: { text: string; ts: number }[] }>(
      `SELECT notes FROM sessions WHERE id = $1`, [sessionId]
    )
    const priorNotes = sessRow[0]?.notes ?? []
    const priorContext = priorNotes.slice(-5).map(n => `[${n.ts}s] ${n.text}`).join('\n')

    try {
      const summary = await summarizeChunk({
        newTranscript: transcriptText,
        priorContext,
        startTimeSec: body.start_time_sec,
      })
      notes = summary.notes
    } catch (e) {
      chunkError = chunkError ?? 'llm_failed'
      // eslint-disable-next-line no-console
      console.warn('[stream-audio] LLM failed (after retries); skipping notes:', e instanceof Error ? e.message : e)
    }
  }

  if (notes.length > 0) {
    await query(
      `UPDATE sessions SET notes = notes || $1::jsonb, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(notes), sessionId]
    )
  }

  // Only count usage when we actually produced a transcript. Otherwise the
  // user shouldn't be charged seconds against their quota.
  if (transcriptText.trim().length > 0) {
    await recordUsage(payload.sub, Math.ceil(body.duration_sec))
  }

  if (notes.length > 0) {
    await sendToSession(sessionId, {
      type: 'note_chunk',
      notes,
    })
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: sessionId,
      added: notes.length,
      transcript_preview: transcriptText.slice(0, 80),
      ...(chunkError ? { chunk_error: chunkError } : {}),
    }),
  }
}
