import { withAuth } from '../lib/auth.js'
import { query } from '../lib/db.js'
import { presignGet } from '../lib/s3-presigned.js'
import { outlineToObsidianMarkdown } from '../lib/markdown-obsidian.js'
import type { Outline } from '../lib/curator.js'
import { createHash } from 'node:crypto'

function normalizeUrl(u: string): string {
  const url = new URL(u); url.hash = ''; return url.toString()
}

interface SlideRow { ts: number; key: string; url?: string }

export const handler = withAuth(async (event, payload) => {
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
    // pg returns timestamp columns as Date objects by default. Keep the
    // type honest; the markdown branch coerces to YYYY-MM-DD via
    // toISOString rather than relying on an implicit string cast.
    created_at: Date | string
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
    // Pre-sign slide URLs so the markdown can embed working `![](url)`
    // image references. The frontend zip-export path post-rewrites
    // these URLs into local `Attachments/Study-Helper/<sess>/...`
    // paths so once the zip is unpacked into a vault the wikilinks
    // resolve. Plain-md export (no zip) keeps the presigned URLs —
    // they work for ~1 hour, after which the user would re-export.
    const slidesPresigned = Array.isArray(session.slides)
      ? await Promise.all(
          session.slides.map(async (s) => ({
            ts: s.ts,
            key: s.key,
            url: await presignGet(s.key),
          })),
        )
      : []
    // pg's node-postgres returns `timestamp` columns as Date objects
    // (the TS interface annotation `created_at: string` was wishful).
    // Coerce to YYYY-MM-DD via toISOString — works for both Date input
    // (live DB) and string input (just in case a serializer is added).
    const createdAtIso = session.created_at instanceof Date
      ? session.created_at.toISOString()
      : String(session.created_at)
    // Heading-language. The curator-emitted prose is in whatever
    // language the user set as their note language at curate time; for
    // the markdown skeleton (callouts / section headings / frontmatter
    // labels) we honour the `?lang=` query param which the client
    // appends from its current preference. Falls through to 'ja' for
    // legacy clients / when the user picked 'auto' (we have no way to
    // detect the curator's actual choice from JSON output).
    const langParam = event.queryStringParameters?.lang
    const lang: 'ja' | 'en' | 'ko' | 'zh' = (langParam === 'en' || langParam === 'ko' || langParam === 'zh' || langParam === 'ja') ? langParam : 'ja'
    const md = outlineToObsidianMarkdown(session.outline, {
      sourceUrl: session.url_original,
      sessionId: session.id,
      generatedAt: new Date(),
      lectureDate: createdAtIso.slice(0, 10),
      slides: slidesPresigned,
      lang,
    })
    // Filename is built from the title, falling back to session id slice.
    const title = (session.outline.title || session.id.slice(0, 8))
      .replace(/[\\/:"*?<>|]/g, '_')   // illegal filename chars
      .slice(0, 80)
    // See session-curate.ts for the headers `as Record<string, string>`
    // rationale (TS union-narrowing of return shapes).
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(title)}.md`,
      } as Record<string, string>,
      body: md,
    }
  }

  if (session && Array.isArray(session.slides)) {
    // Sign all GET URLs in PARALLEL. The previous version awaited each
    // presignGet sequentially via map+await, blocking the response on N
    // serial S3 round-trips for a 60-slide session. Promise.all on the
    // map drops that to the slowest single request.
    session.slides = await Promise.all(
      session.slides.map(async (s) => ({ ...s, url: await presignGet(s.key) })),
    )
  }
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session }),
  }
})
