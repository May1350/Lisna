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
  const transcript = await transcribeChunk(audioBuf, body.mime)

  const urlHash = createHash('sha256').update(normalizeUrl(body.url)).digest('hex')

  // upsert session row
  await query(
    `INSERT INTO sessions (id, user_id, url_hash, url_original)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, url_hash) DO UPDATE SET updated_at = NOW()`,
    [body.session_id, payload.sub, urlHash, body.url]
  )

  // gather prior context: last 5 notes
  const sessRow = await query<{ notes: { text: string; ts: number }[] }>(
    `SELECT notes FROM sessions WHERE id = $1`, [body.session_id]
  )
  const priorNotes = sessRow[0]?.notes ?? []
  const priorContext = priorNotes.slice(-5).map(n => `[${n.ts}s] ${n.text}`).join('\n')

  const summary = await summarizeChunk({
    newTranscript: transcript.text,
    priorContext,
    startTimeSec: body.start_time_sec,
  })

  if (summary.notes.length > 0) {
    await query(
      `UPDATE sessions SET notes = notes || $1::jsonb, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(summary.notes), body.session_id]
    )
  }

  await recordUsage(payload.sub, Math.ceil(body.duration_sec))

  await sendToSession(body.session_id, {
    type: 'note_chunk',
    notes: summary.notes,
  })

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ added: summary.notes.length, transcript_preview: transcript.text.slice(0, 80) }),
  }
}
