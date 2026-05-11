import type { APIGatewayProxyHandlerV2, APIGatewayProxyResultV2 } from 'aws-lambda'
import { query } from '../lib/db.js'
import { presignGet } from '../lib/s3-presigned.js'
import { isWarmup, warmupResponse } from '../lib/warmup.js'
import { outlineToObsidianMarkdown } from '../lib/markdown-obsidian.js'
import type { Outline } from '../lib/curator.js'
import { createHash } from 'node:crypto'
import { withAuth } from '../lib/with-auth.js'

function normalizeUrl(u: string): string {
  const url = new URL(u); url.hash = ''; return url.toString()
}

interface SlideRow { ts: number; key: string }
interface TranscriptRow { ts: number; text: string }

const authed = withAuth('session-get', async (event, payload): Promise<APIGatewayProxyResultV2> => {
  const url = event.queryStringParameters?.url
  if (!url) return { statusCode: 400, body: 'missing url' }
  const format = event.queryStringParameters?.format ?? 'json'
  const urlHash = createHash('sha256').update(normalizeUrl(url)).digest('hex')

  const rows = await query<{
    id: string
    notes: unknown
    slides: SlideRow[]
    outline: Outline | null
    // Persisted live-caption history. The modal restores its
    // LiveTranscript surface from this on reopen / page reload — the
    // legacy response shape only sent slides + outline, so users who
    // closed the side panel mid-lecture lost everything they had read.
    // Always returned as an array so the consumer doesn't have to
    // null-check; older rows that pre-date the column default get the
    // jsonb default '[]'.
    transcripts: TranscriptRow[]
    status: string
    // pg's node-postgres returns timestamp columns as Date objects by
    // default. The earlier `created_at: string` annotation was wishful
    // and caused a runtime `created_at.slice is not a function` 500 in
    // the markdown branch — coerce explicitly below.
    created_at: Date | string
    updated_at: Date
    url_original: string
  }>(
    `SELECT id, notes, slides, outline,
            COALESCE(transcripts, '[]'::jsonb) AS transcripts,
            status, created_at, updated_at, url_original
       FROM sessions
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
    const createdAtIso = session.created_at instanceof Date
      ? session.created_at.toISOString()
      : String(session.created_at)
    // Presign each captured slide so the markdown can embed working
    // `![](url)` image refs. The frontend's zip-export pipeline rewrites
    // these URLs into bare filenames against a local Attachments folder
    // so the unzipped vault resolves images without the (1 h) presign
    // TTL ever mattering.
    const slidesPresigned = Array.isArray(session.slides)
      ? await Promise.all(
          session.slides.map(async (s) => ({
            ts: s.ts,
            key: s.key,
            url: await presignGet(s.key),
          })),
        )
      : []
    const md = outlineToObsidianMarkdown(session.outline, {
      sourceUrl: session.url_original,
      sessionId: session.id,
      generatedAt: new Date(),
      lectureDate: createdAtIso.slice(0, 10),
      slides: slidesPresigned,
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
})

export const handler: APIGatewayProxyHandlerV2 = async (event, ctx, cb) => {
  if (isWarmup(event)) return warmupResponse()
  return (await authed(event, ctx, cb)) as APIGatewayProxyResultV2
}
