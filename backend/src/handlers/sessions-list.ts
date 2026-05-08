// GET /v1/sessions — list the authed user's recent sessions.
//
// Powers the side-panel "履歴" view: students who've captured 5-10
// lectures want to flip back to an old one without re-navigating to
// the source URL. This endpoint returns a compact summary list (no
// transcripts, no slide URLs — just enough to render the row + jump
// to the URL where the full outline is auto-loaded by the existing
// /v1/session?url=… path).
//
// Response shape kept lean: a 100-row payload should land well under
// 50 KB. The richer fields (outline, slides, transcripts) stay in
// /v1/session?url=… which is fetched on demand when the user clicks
// a row.
import { withAuth } from '../lib/auth.js'
import { query } from '../lib/db.js'

interface SessionRow {
  id: string
  url_original: string
  status: string
  created_at: Date | string
  updated_at: Date | string
  title: string | null
  slide_count: number
  has_outline: boolean
}

export const handler = withAuth(async (_event, payload) => {
  const rows = await query<SessionRow>(
    `SELECT
       id,
       url_original,
       status,
       created_at,
       updated_at,
       outline->>'title'                                  AS title,
       jsonb_array_length(COALESCE(slides, '[]'::jsonb))  AS slide_count,
       (outline IS NOT NULL)                              AS has_outline
     FROM sessions
     WHERE user_id = $1 AND status != 'deleted'
     ORDER BY updated_at DESC
     LIMIT 100`,
    [payload.sub],
  )

  const sessions = rows.map(r => ({
    id: r.id,
    url: r.url_original,
    title: r.title,
    status: r.status,
    slide_count: Number(r.slide_count) || 0,
    has_outline: r.has_outline,
    // pg returns timestamp columns as Date objects by default; coerce
    // to ISO string so the API surface is JSON-clean. Same defensive
    // pattern used in session-get.ts for the markdown export branch.
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    updated_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
  }))

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessions }),
  }
})
