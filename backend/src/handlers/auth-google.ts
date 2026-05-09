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

interface SlideRow { ts: number; ocr_text?: string; image_key?: string }
interface OutlineRow { title: string; sections: unknown[] }

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

    // Single round-trip upsert: insert if new, refresh email/display_name on
    // returning users so profile changes (Google name update, email migration)
    // propagate without a separate UPDATE path.
    const upserted = await query<{ id: string; plan: 'free' | 'pro' }>(
      `INSERT INTO users (google_sub, email, display_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (google_sub) DO UPDATE
         SET email = EXCLUDED.email,
             display_name = EXCLUDED.display_name,
             updated_at = NOW()
       RETURNING id, plan`,
      [g.sub, g.email, g.name ?? null]
    )
    const userId = upserted[0].id
    const plan = upserted[0].plan

    // 90 days. Personal study tool — long TTL is fine; it just means the user
    // re-authenticates with Google ~quarterly instead of weekly. Keeps the
    // multi-account chooser out of the user's hair on the typical use cycle.
    const token = await signJwt({ sub: userId, plan }, 60 * 60 * 24 * 90)

    // Optional eager-load: if the caller passed current_url, look up the
    // existing session for that (user, url) pair in the same Lambda invocation
    // so the modal can render notes immediately without GET /v1/session.
    // updated_at lets the modal show the actual last-edit time of the
    // outline (set by curate/stream handlers via NOW()) instead of
    // re-stamping to "just now" every time the modal hydrates a saved
    // session. pg returns TIMESTAMP as Date; JSON.stringify emits an
    // ISO string the client parses with new Date(...).getTime().
    let currentSession: { id: string; slides: SlideRow[]; outline: OutlineRow | null; updated_at: Date } | null = null
    if (current_url) {
      try {
        const urlHash = createHash('sha256').update(normalizeUrl(current_url)).digest('hex')
        const sessRow = await query<{ id: string; slides: SlideRow[]; outline: OutlineRow | null; updated_at: Date }>(
          `SELECT id, slides, outline, updated_at FROM sessions WHERE user_id = $1 AND url_hash = $2`,
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
    // Without this breadcrumb the previous version returned 400 with no
    // CloudWatch trace — production debugging had to go through the
    // extension's user-facing toast (which only had the HTTP status,
    // not the message). When login fails, the operator now has both:
    // 1) the backend log (here) with full message + stack, 2) the
    // extension's LoginScreen showing the response body's {error}.
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[auth-google] login failed', {
      msg,
      stack: e instanceof Error ? e.stack : undefined,
    })
    return {
      statusCode: 400,
      body: JSON.stringify({ error: msg }),
    }
  }
}
