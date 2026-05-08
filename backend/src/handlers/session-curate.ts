// On-demand curator endpoint (Phase 6.1).
//
// The modal triggers this when the user wants notes generated:
//   - <video> pause (debounced 3 s)
//   - <video> ended
//   - manual "📝 ノートを生成" button click
//   - session stop
//
// Why on-demand instead of rolling-on-every-chunk:
//   - 1 h lecture: rolling fired 120× × ~$0.001 = $0.12. On-demand fires
//     1-3× × ~$0.003 = ~$0.005-0.01. ~95% LLM cost reduction.
//   - Quality goes UP because the model sees the FULL transcript, not a
//     16 K-char tail window.
//   - Removes the 60-90 s GPT-5-nano latency from the per-chunk hot path,
//     which was causing 60 s Lambda timeouts in stream-audio.
//
// Input: { session_id }. Auth: Bearer JWT.
// Output: { outline } (also broadcast over WS for any other clients).

import type { APIGatewayProxyHandlerV2 } from 'aws-lambda'
import { verifyJwt } from '../lib/auth.js'
import { curateOutline, type Outline } from '../lib/curator.js'
import { sendToSession } from '../lib/ws-broadcast.js'
import { query } from '../lib/db.js'
import { loadAppSecrets } from '../lib/env.js'
import { isWarmup, warmupResponse } from '../lib/warmup.js'
import { z } from 'zod'

const Body = z.object({
  session_id: z.string().uuid(),
  // Optional flag: when true, drop previousOutline entirely so the model
  // gets a fresh-perspective rebuild (used by the manual "regenerate"
  // button in the modal).
  full_rewrite: z.boolean().optional(),
})

interface TranscriptEntry { ts: number; text: string }

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  if (isWarmup(event)) return warmupResponse()
  await loadAppSecrets()
  const auth = event.headers.authorization || event.headers.Authorization
  if (!auth?.startsWith('Bearer ')) return { statusCode: 401, body: 'unauthorized' }

  let payload
  try { payload = await verifyJwt(auth.slice(7)) }
  catch { return { statusCode: 401, body: 'invalid token' } }

  const body = Body.parse(JSON.parse(event.body || '{}'))

  // Per-session curate lock (see migrations/003_curate_lock.sql).
  // Compare-and-swap on curate_lock_at: only acquire if either no
  // lock is held OR a stale lock has aged past the 5-minute TTL
  // (Lambda crash recovery — without this a single mid-curate crash
  // would permanently lock the user out). The combined ownership +
  // freshness check happens atomically in the UPDATE's WHERE clause,
  // so two concurrent curates can't both see the lock as available.
  // RETURNING id on a 0-row result tells us the lock was busy AND
  // distinguishes that from "session not found / wrong owner".
  const lockAcquired = await query<{ id: string }>(
    `UPDATE sessions
       SET curate_lock_at = NOW()
       WHERE id = $1
         AND user_id = $2
         AND (curate_lock_at IS NULL OR curate_lock_at < NOW() - INTERVAL '5 minutes')
       RETURNING id`,
    [body.session_id, payload.sub],
  )
  if (lockAcquired.length === 0) {
    // Either the session doesn't belong to the caller, or another
    // curate is in flight. Probe ownership separately so we return
    // the correct status — 404 vs 409 — without revealing existence
    // of someone else's session via the in-progress signal.
    const owned = await query<{ id: string }>(
      `SELECT id FROM sessions WHERE id = $1 AND user_id = $2`,
      [body.session_id, payload.sub],
    )
    if (owned.length === 0) {
      return { statusCode: 404, body: JSON.stringify({ error: 'session not found' }) }
    }
    return {
      statusCode: 409,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'curate_in_progress' }),
    }
  }

  try {
    // Fetch the full transcript + previous outline. We re-read here
    // (rather than reusing the lock UPDATE's RETURNING) because the
    // jsonb fields are heavy and there's no point pulling them
    // through the lock acquisition path.
    const rows = await query<{ transcripts: TranscriptEntry[]; outline: Outline | null }>(
      `SELECT transcripts, outline FROM sessions WHERE id = $1`,
      [body.session_id],
    )
    const transcripts = rows[0]?.transcripts ?? []
    const previousOutline = rows[0]?.outline ?? null

    // Empty session — nothing to curate. Caller should retry once the
    // user has actually played some audio.
    if (transcripts.length === 0) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outline: null, reason: 'no_transcripts_yet' }),
      }
    }

    // Run the curator over the FULL transcript. Unlike the old rolling
    // model this does NOT tail-window — we want every line of speech
    // available so the hierarchy reasoning is complete. (For very long
    // lectures the curator's own internal char-budget will still kick in
    // to stay under the LLM's TPM cap.)
    let outline: Outline
    try {
      outline = await curateOutline({
        bucketedTranscript: transcripts,
        previousOutline,
        forceFullRewrite: body.full_rewrite ?? false,
      })
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[session-curate] curator failed:', e instanceof Error ? e.message : e)
      return {
        statusCode: 502,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'curator_failed',
          message: e instanceof Error ? e.message : 'unknown',
        }),
      }
    }

    // Persist + broadcast.
    await query(
      `UPDATE sessions SET outline = $1::jsonb, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(outline), body.session_id],
    )
    void sendToSession(body.session_id, {
      type: 'outline_updated',
      outline,
      full_rewrite: body.full_rewrite ?? false,
    }).catch(e => console.warn('[session-curate] outline broadcast failed:', e))

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outline }),
    }
  } finally {
    // Always release. If this UPDATE itself errors (DB connection
    // gone, etc.) the 5-minute TTL is the safety net. We swallow the
    // error rather than let it mask the real response/exception path.
    try {
      await query(
        `UPDATE sessions SET curate_lock_at = NULL WHERE id = $1`,
        [body.session_id],
      )
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[session-curate] lock release failed (TTL will recover):', e instanceof Error ? e.message : e)
    }
  }
}
