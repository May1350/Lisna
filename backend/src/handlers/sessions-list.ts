import type { APIGatewayProxyHandlerV2 } from 'aws-lambda'
import { verifyJwt } from '../lib/auth.js'
import { query } from '../lib/db.js'
import { loadAppSecrets } from '../lib/env.js'
import { isWarmup, warmupResponse } from '../lib/warmup.js'

// GET /v1/sessions — compact list of the caller's recent sessions for the
// side-panel SessionHistory component. Read-only, no pagination cursor:
// we cap at 100 most-recently-updated rows, which covers the v1 product
// goal ("where was I?") without paying for keyset-pagination plumbing.
//
// Response shape MUST match extension/src/side-panel/components/SessionHistory.tsx
// SessionSummary interface — drift here white-screens the side panel.
interface SessionRow {
  id: string
  url: string
  // outline->>'title' is text (NULL when outline is NULL or has no title key).
  title: string | null
  status: string
  // jsonb_array_length returns bigint — pg streams this as a string by
  // default. We coerce to number below so the JSON response carries a
  // number primitive (frontend reads it as `slide_count: number`).
  slide_count: number | string
  has_outline: boolean
  // pg returns timestamp columns as Date by default; mirror the
  // session-get.ts coercion pattern so the wire shape is always ISO 8601.
  created_at: Date | string
  updated_at: Date | string
}

function toIso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : String(v)
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  if (isWarmup(event)) return warmupResponse()
  await loadAppSecrets()

  const auth = event.headers.authorization || event.headers.Authorization
  if (!auth?.startsWith('Bearer ')) {
    return { statusCode: 401, body: JSON.stringify({ error: 'unauthorized' }) }
  }
  let payload
  try {
    payload = await verifyJwt(auth.slice(7))
  } catch {
    return { statusCode: 401, body: JSON.stringify({ error: 'invalid token' }) }
  }

  const rows = await query<SessionRow>(
    `SELECT
       id,
       url_original AS url,
       outline->>'title' AS title,
       status,
       jsonb_array_length(COALESCE(slides, '[]'::jsonb)) AS slide_count,
       (outline IS NOT NULL) AS has_outline,
       created_at,
       updated_at
     FROM sessions
     WHERE user_id = $1 AND status != 'deleted'
     ORDER BY updated_at DESC
     LIMIT 100`,
    [payload.sub]
  )

  const sessions = rows.map((r) => ({
    id: r.id,
    url: r.url,
    title: r.title ?? null,
    status: r.status,
    // Coerce bigint-as-string → number; COALESCE in SQL guarantees non-NULL.
    slide_count: typeof r.slide_count === 'number' ? r.slide_count : Number(r.slide_count),
    has_outline: r.has_outline,
    created_at: toIso(r.created_at),
    updated_at: toIso(r.updated_at),
  }))

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessions }),
  }
}
