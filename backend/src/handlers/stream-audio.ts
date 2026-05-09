import type { APIGatewayProxyHandlerV2 } from 'aws-lambda'
import { verifyJwt } from '../lib/auth.js'
import { transcribeChunk } from '../lib/stt.js'
import { checkQuota, recordUsage } from '../lib/quota.js'
import { sendToSession } from '../lib/ws-broadcast.js'
import { query } from '../lib/db.js'
import { loadAppSecrets } from '../lib/env.js'
import { isWarmup, warmupResponse } from '../lib/warmup.js'
import { classifyUpstreamError, publishUpstreamAlert } from '../lib/upstream-alert.js'
import { createHash } from 'node:crypto'
import { z } from 'zod'

// Phase 6.1 (2026-04-29): on-demand curator pivot.
// stream-audio is now ONLY the live STT path:
//   1. Run STT on the chunk
//   2. Append to session.transcripts[]
//   3. Broadcast transcript_chunk over WS for the modal's live captions
//
// The curator is no longer triggered here. It runs in a separate handler
// (session-curate.ts → POST /v1/session/:id/curate) which the modal calls
// when:
//   - the user pauses the video (debounced)
//   - the video ends
//   - the user clicks the manual "📝 ノートを生成" button
//   - the user stops the session
//
// This drops the per-chunk Lambda time from 60-90 s (curator was the
// bottleneck) to 1-3 s (just STT + DB append + WS broadcast). It also
// reduces curator calls per 1 h lecture from ~120 to ~1-3, slashing LLM
// cost from ~$0.12 to ~$0.005 — a 96% reduction with HIGHER quality
// because the on-demand call sees the full transcript instead of a
// 16 K-char tail window.

const Body = z.object({
  session_id: z.string().uuid(),
  url: z.string().url(),
  start_time_sec: z.number().nonnegative(),
  duration_sec: z.number().positive(),
  audio_b64: z.string().min(1),
  mime: z.string(),
})

interface TranscriptEntry { ts: number; text: string }

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
  // Build the QuotaSnapshot the extension consumes (matches the shape
  // returned by /v1/auth/me — see auth-me.ts). The same shape is also
  // re-emitted post-recordUsage so the frontend's quota state stays
  // current chunk-by-chunk; without this the QuotaBanner in App.tsx
  // can't tell when the user crosses the 90% threshold and the
  // upgrade nudge never appears.
  const buildSnapshot = (used: number, limit: number, plan: typeof userPlan) => ({
    used_secs: used,
    limit_secs: limit,
    remaining_secs: Math.max(0, limit - used),
    percent_used: Math.min(100, Math.round((used / Math.max(1, limit)) * 100)),
    plan,
  })
  if (!quota.allowed) {
    return {
      statusCode: 402,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'quota_exceeded',
        remaining_secs: 0,
        // Snapshot the content script needs to (a) flip the modal's
        // blocking banner and (b) call stopCaptureLocal cleanly. The
        // earlier response omitted this field which silently broke
        // both code paths — the user sat in a "still recording"
        // illusion while every chunk 402'd until they manually
        // stopped capture.
        quota: buildSnapshot(quota.used, quota.limit, userPlan),
      }),
    }
  }

  const audioBuf = Buffer.from(body.audio_b64, 'base64').buffer

  // ── 1. UPSERT SESSION ROW ──────────────────────────────────────────────
  // Always return canonical session_id even on STT failure so the client
  // adopts it and connects WS. Any later /v1/session/:id/curate call will
  // find an empty (or partial) transcripts array and decide what to do.
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
    // eslint-disable-next-line no-console
    console.warn('[stream-audio] STT failed; skipping chunk:', e instanceof Error ? e.message : e)
    // Operator-side classification. If Groq's key is invalid or quota
    // is hit, every chunk for every user fails the same way and the
    // user sees zero captions. Surfacing a 503 here lets the modal
    // show a "service issue" banner and lets the content script stop
    // burning bandwidth on chunks that won't produce captions until
    // the operator intervenes.
    const upstream = classifyUpstreamError(e, 'groq')
    if (upstream) {
      void publishUpstreamAlert(upstream, 'stt').catch(err =>
        console.warn('[stream-audio] upstream-alert publish failed:', err instanceof Error ? err.message : err)
      )
      return {
        statusCode: 503,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'service_unavailable',
          session_id: sessionId,
          provider: upstream.provider,
          kind: upstream.kind,
        }),
      }
    }
    chunkError = 'stt_failed'
  }

  if (transcriptText.length === 0) {
    // Empty / failed-STT chunks don't trigger recordUsage, so the
    // pre-charge snapshot is still accurate. Forward it so the modal's
    // QuotaBanner stays current even on dead-air sessions where every
    // chunk is silent.
    return ok(sessionId, {
      chunk_error: chunkError ?? 'empty_transcript',
      quota: buildSnapshot(quota.used, quota.limit, userPlan),
    })
  }

  // ── 3. Append transcript + live broadcast ───────────────────────────────
  const transcriptEntry: TranscriptEntry = {
    ts: Math.round(body.start_time_sec),
    text: transcriptText,
  }

  void sendToSession(sessionId, {
    type: 'transcript_chunk',
    ts: transcriptEntry.ts,
    text: transcriptEntry.text,
  }).catch(e => console.warn('[stream-audio] live transcript broadcast failed:', e))

  // Defense-in-depth: explicit user_id filter even though sessionId came
  // from the CAS upsert above (which is keyed on (user_id, url_hash) so
  // ownership is already guaranteed). The explicit AND survives future
  // refactors that might separate the upsert from this UPDATE — matches
  // the pattern in stream-slide.ts.
  await query(
    `UPDATE sessions
       SET transcripts = COALESCE(transcripts, '[]'::jsonb) || $1::jsonb,
           updated_at  = NOW()
     WHERE id = $2 AND user_id = $3`,
    [JSON.stringify([transcriptEntry]), sessionId, payload.sub],
  )

  await recordUsage(payload.sub, Math.ceil(body.duration_sec))

  // Re-snapshot AFTER recordUsage so the frontend sees the post-charge
  // state. percent_used updates here are what drive the QuotaBanner's
  // 90% / 100% threshold transitions (see App.tsx's quota_update
  // SP_BROADCAST handler). The pre-charge snapshot from line above
  // would always trail by one chunk and miss the threshold crossing
  // on the very chunk that crossed it.
  const charged = quota.used + Math.ceil(body.duration_sec)
  const liveSnapshot = buildSnapshot(charged, quota.limit, userPlan)

  return ok(sessionId, {
    transcript_preview: transcriptText.slice(0, 80),
    quota: liveSnapshot,
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
