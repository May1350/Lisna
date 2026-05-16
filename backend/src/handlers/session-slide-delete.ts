import type { APIGatewayProxyResultV2 } from 'aws-lambda'
import { createHash } from 'node:crypto'
import { withAuth } from '../lib/with-auth.js'
import { query } from '../lib/db.js'

function normalizeUrl(u: string): string {
  const url = new URL(u); url.hash = ''; return url.toString()
}

interface SlideRow { ts: number; key: string; hash?: string }

interface DeleteBody { url?: string; key?: string }

// POST /v1/session/slides/delete  →  Manual slide removal.
// User clicks the hover-X on a thumbnail; frontend posts {url, key}; we
// locate the session by (user_id, url_hash) and filter that key out of
// the slides JSONB array. Hard delete (no soft-delete column today —
// follow-up if revert is needed). S3 object cleanup is deferred to a
// background sweep so this handler stays fast and won't fail on a
// stuck S3 call.
export const handler = withAuth('session-slide-delete', async (event, payload): Promise<APIGatewayProxyResultV2> => {
  if (!event.body) return { statusCode: 400, body: 'no body' }
  let body: DeleteBody
  try { body = JSON.parse(event.body) as DeleteBody } catch { return { statusCode: 400, body: 'invalid json' } }
  if (!body.url || !body.key) return { statusCode: 400, body: 'missing url or key' }

  const urlHash = createHash('sha256').update(normalizeUrl(body.url)).digest('hex')
  const rows = await query<{ id: string; slides: SlideRow[] | null }>(
    `SELECT id, slides FROM sessions WHERE user_id = $1 AND url_hash = $2`,
    [payload.sub, urlHash],
  )
  if (rows.length === 0) return { statusCode: 404, body: 'session not found' }
  const session = rows[0]
  const slides = Array.isArray(session.slides) ? session.slides : []
  const filtered = slides.filter(s => s.key !== body.key)
  if (filtered.length === slides.length) {
    return { statusCode: 404, body: 'slide key not found in session' }
  }

  await query(
    `UPDATE sessions SET slides = $1::jsonb, updated_at = NOW() WHERE id = $2 AND user_id = $3`,
    [JSON.stringify(filtered), session.id, payload.sub],
  )

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ removed: 1, kept: filtered.length }),
  }
})
