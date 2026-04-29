import type { APIGatewayProxyHandlerV2 } from 'aws-lambda'
import { verifyJwt } from '../lib/auth.js'
import { query } from '../lib/db.js'
import { loadAppSecrets } from '../lib/env.js'
import { presignGet } from '../lib/s3-presigned.js'
import { isWarmup, warmupResponse } from '../lib/warmup.js'
import { outlineToObsidianMarkdown } from '../lib/markdown-obsidian.js'
import type { Outline } from '../lib/curator.js'
import { createHash } from 'node:crypto'

function normalizeUrl(u: string): string {
  const url = new URL(u); url.hash = ''; return url.toString()
}

interface SlideRow { ts: number; key: string }

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  if (isWarmup(event)) return warmupResponse()
  await loadAppSecrets()
  const auth = event.headers.authorization || event.headers.Authorization
  if (!auth?.startsWith('Bearer ')) return { statusCode: 401, body: 'unauthorized' }
  let payload
  try { payload = await verifyJwt(auth.slice(7)) }
  catch { return { statusCode: 401, body: 'invalid token' } }

  const url = event.queryStringParameters?.url
  if (!url) return { statusCode: 400, body: 'missing url' }
  const format = event.queryStringParameters?.format ?? 'json'
  const urlHash = createHash('sha256').update(normalizeUrl(url)).digest('hex')

  const rows = await query<{
    id: string
    notes: unknown
    slides: SlideRow[]
    outline: Outline | null
    status: string
    created_at: string
    url_original: string
  }>(
    `SELECT id, notes, slides, outline, status, created_at, url_original FROM sessions
     WHERE user_id = $1 AND url_hash = $2 AND status != 'deleted'`,
    [payload.sub, urlHash]
  )
  const session = rows[0] ?? null

  // ── Markdown export branch (Phase 6) ───────────────────────────────────
  // ?format=markdown returns Obsidian-flavored .md as text/plain so the
  // browser can save it directly. The OutlineView in the modal continues
  // to render the same source-of-truth Outline as plain UI (no markdown
  // syntax visible there), so this branch is the ONLY place markdown
  // syntax leaks out — and only when the user explicitly asks for it.
  if (format === 'markdown') {
    if (!session || !session.outline) {
      return { statusCode: 404, body: 'no curated outline yet' }
    }
    const md = outlineToObsidianMarkdown(session.outline, {
      sourceUrl: session.url_original,
      sessionId: session.id,
      generatedAt: new Date(),
      lectureDate: session.created_at.slice(0, 10),
    })
    // Filename is built from the title, falling back to session id slice.
    const title = (session.outline.title || session.id.slice(0, 8))
      .replace(/[\\/:"*?<>|]/g, '_')   // illegal filename chars
      .slice(0, 80)
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(title)}.md`,
      },
      body: md,
    }
  }

  if (session && Array.isArray(session.slides)) {
    session.slides = await Promise.all(
      session.slides.map(async (s) => ({ ...s, url: await presignGet(s.key) }))
    ) as SlideRow[] & { url: string }[]
  }
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session }),
  }
}
