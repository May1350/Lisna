import type { APIGatewayProxyHandlerV2 } from 'aws-lambda'
import { verifyGoogleIdToken, verifyGoogleAccessToken, signJwt } from '../lib/auth.js'
import { query } from '../lib/db.js'
import { loadAppSecrets } from '../lib/env.js'
import { isWarmup, warmupResponse } from '../lib/warmup.js'
import { createHash } from 'node:crypto'
import { z } from 'zod'

// Accept EITHER an id_token (legacy launchWebAuthFlow path) OR an access_token
// (new chrome.identity.getAuthToken path). Exactly one is required.
const Body = z.object({
  id_token: z.string().min(1).optional(),
  access_token: z.string().min(1).optional(),
  // Optional: when present, the response also returns the user's existing
  // session for that page (if any), so the modal can hydrate notes/slides
  // without an extra GET /v1/session round-trip.
  current_url: z.string().url().optional(),
}).refine(d => !!d.id_token || !!d.access_token, {
  message: 'either id_token or access_token is required',
})

interface NoteRow { ts: number; text: string; important: boolean }
interface SlideRow { ts: number; ocr_text?: string; image_key?: string }

function normalizeUrl(u: string): string {
  const url = new URL(u)
  url.hash = ''
  return url.toString()
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  if (isWarmup(event)) return warmupResponse()
  try {
    await loadAppSecrets()
    const { id_token, access_token, current_url } = Body.parse(JSON.parse(event.body || '{}'))
    const g = id_token
      ? await verifyGoogleIdToken(id_token)
      : await verifyGoogleAccessToken(access_token!)

    const existing = await query<{ id: string; plan: 'free' | 'pro' }>(
      `SELECT id, plan FROM users WHERE google_sub = $1`, [g.sub]
    )
    let userId: string
    let plan: 'free' | 'pro' = 'free'
    if (existing.length > 0) {
      userId = existing[0].id
      plan = existing[0].plan
    } else {
      const inserted = await query<{ id: string }>(
        `INSERT INTO users (google_sub, email, display_name) VALUES ($1, $2, $3) RETURNING id`,
        [g.sub, g.email, g.name ?? null]
      )
      userId = inserted[0].id
    }

    // 90 days. Personal study tool — long TTL is fine; it just means the user
    // re-authenticates with Google ~quarterly instead of weekly. Keeps the
    // multi-account chooser out of the user's hair on the typical use cycle.
    const token = await signJwt({ sub: userId, plan }, 60 * 60 * 24 * 90)

    // Optional eager-load: if the caller passed current_url, look up the
    // existing session for that (user, url) pair in the same Lambda invocation
    // so the modal can render notes immediately without GET /v1/session.
    let currentSession: { id: string; notes: NoteRow[]; slides: SlideRow[] } | null = null
    if (current_url) {
      try {
        const urlHash = createHash('sha256').update(normalizeUrl(current_url)).digest('hex')
        const sessRow = await query<{ id: string; notes: NoteRow[]; slides: SlideRow[] }>(
          `SELECT id, notes, slides FROM sessions WHERE user_id = $1 AND url_hash = $2`,
          [userId, urlHash],
        )
        if (sessRow.length > 0) currentSession = sessRow[0]
      } catch {
        // Eager-load is best-effort; the client will fall back to the explicit
        // GET /v1/session call if currentSession is missing.
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        user: { id: userId, email: g.email, name: g.name, plan },
        currentSession,
      }),
    }
  } catch (e) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: e instanceof Error ? e.message : 'unknown' }),
    }
  }
}
