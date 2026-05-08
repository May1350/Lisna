// Export pipelines used by both the manual ExportMenu UI and the
// auto-download path triggered by App.tsx on session-ended (when the
// user has opted into the auto-download setting).
//
// Three formats:
//   - `markdown`  : plain .md download
//   - `clipboard` : copy markdown to system clipboard
//   - `zip`       : .md + slide attachments, layout matches Obsidian's
//                   `Attachments/Lisna/<sess>/` convention.
//
// The zip path uses fflate via dynamic import so the ~14 KB library
// only loads when the user actually triggers an export. We considered
// a server-side zip but ruled it out — API Gateway has a hard 6 MB
// response limit, which a 4 h lecture (~500 slides × 25 KB ≈ 12 MB)
// would blow through. Client-side has no such ceiling because each
// slide is fetched directly from S3 via its presigned URL.

import { API_BASE_URL } from '../../shared/config'
import { getToken, getObsidianConfig, type ObsidianConfig } from '../../shared/storage'
import { getLang, getNoteLang, t, interpolate } from '../../shared/i18n'
import type { SlideItem } from '../../shared/types'

export interface ExportInput {
  /** Page URL the session is bound to — used as the ?url= key on the
   *  /v1/session?format=markdown lookup. */
  sourceUrl: string
  /** Lecture title (used for filename). */
  title: string
  /** Captured slides with fresh presigned URLs. */
  slides: SlideItem[]
  /** Canonical session id — used as the Attachments folder name in the
   *  zip so multiple lectures don't collide if unzipped together. */
  sessionId: string
}

// Strip filesystem-illegal characters from user-supplied strings before
// using them in download filenames or zip-entry paths.
function safeFsName(s: string, maxLen = 80): string {
  return (s || 'lecture').replace(/[\\/:"*?<>|]/g, '_').slice(0, maxLen)
}

// Parse slide.ts (seconds) into a stable, human-readable filename:
// `slide-mm-ss.jpg`. Multiple slides at the same second get a `-N`
// suffix so they don't collide.
function buildSlideFilenames(slides: SlideItem[]): string[] {
  const names: string[] = []
  const used = new Set<string>()
  for (const s of slides) {
    const m = Math.floor(s.ts / 60)
    const sec = Math.floor(s.ts % 60)
    const base = `slide-${m.toString().padStart(2, '0')}-${sec.toString().padStart(2, '0')}`
    let candidate = `${base}.jpg`
    let suffix = 2
    while (used.has(candidate)) {
      candidate = `${base}-${suffix}.jpg`
      suffix++
    }
    used.add(candidate)
    names.push(candidate)
  }
  return names
}

// Browser download trigger — wraps the create-blob-URL + click-anchor
// dance into one call. Always revokes the URL after a tick so memory
// doesn't leak on repeated downloads.
function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Replace the lecture's H1 with the user-edited title so the filename
// and the document's main heading stay in sync. The curator's
// auto-extracted title becomes the H1 emitted by markdown-obsidian.ts;
// when the user edits the filename in the modal we want the .md / .html
// contents to reflect the same name (otherwise opening the file shows
// a different title than the filename, which is jarring).
//
// Only the FIRST H1 is replaced — subsequent `# ...` lines (rare,
// usually shouldn't exist in a single-lecture export, but defensively)
// are left untouched. Uses replace() without `g` flag so only the
// first match changes.
function rewriteFirstH1(md: string, newTitle: string): string {
  return md.replace(/^# .*$/m, `# ${newTitle}`)
}

export async function fetchMarkdown(sourceUrl: string): Promise<string> {
  // /v1/session?url=...&format=markdown returns text/markdown directly.
  // We fetch from the page context (modal iframe) using the stored
  // bearer token; SW round-trip would buffer the whole markdown body
  // into a JSON wrapper which is a waste.
  //
  // Heading-language: if the user's note language is a specific locale
  // (not 'auto'), we want the markdown skeleton (callouts / section
  // headings / frontmatter labels) to match that language. Falls back
  // to the system UI language for 'auto' so a Korean UI user gets
  // Korean callouts even when they let the curator follow the lecture.
  const noteLang = getNoteLang()
  const langForHeadings = noteLang === 'auto' ? getLang() : noteLang
  const token = await getToken()
  const r = await fetch(
    `${API_BASE_URL}/v1/session?url=${encodeURIComponent(sourceUrl)}&format=markdown&lang=${langForHeadings}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!r.ok) throw new Error(`markdown fetch failed: ${r.status}`)
  return await r.text()
}

// Self-contained HTML export. Replaces the previous "single .md with
// embedded base64 images" option which was dead weight: the only
// audience for raw markdown is Obsidian-style vault users, who are
// better served by the .zip option. Non-vault users (the majority —
// students who just want to read / share / print their notes) had no
// good option until now.
//
// HTML is the universal format: it opens in any browser on any OS,
// supports inline images / clickable timestamp links / formatted
// callouts, and the user can `Cmd+P → Save as PDF` if they need a
// print-friendly output. Single self-contained file — slides are
// inlined as `data:image/jpeg;base64,…` URIs so the file is portable
// (no vault, no zip extraction, no expiring presigned URLs).
//
// Trade-off: file size scales with slide count (~150-300 KB per slide
// before base64, ×1.33 after). A 50-slide deck lands ~10-20 MB;
// vault-managed workflows still prefer .zip for the smaller per-image
// footprint, but for one-off shares / printing this is the right tool.
export async function exportHtml(input: ExportInput): Promise<void> {
  const [mdRaw, slides] = await Promise.all([
    fetchMarkdown(input.sourceUrl),
    fetchFreshSlides(input.sourceUrl),
  ])
  const md = rewriteFirstH1(mdRaw, input.title)

  // Fetch each slide's bytes via its fresh presigned URL, encode to
  // base64. Same regex strategy as exportZip: match by the URL's path
  // component (= the stable S3 key) since the presigned URL in the
  // markdown was signed by a separate /v1/session?format=markdown call
  // and won't byte-match the `slides[].url` we just fetched.
  const keyToDataUri = new Map<string, string>()
  await Promise.all(slides.map(async (s) => {
    const r = await fetch(s.url)
    if (!r.ok) throw new Error(`slide ${s.key} fetch ${r.status}`)
    const buf = await r.arrayBuffer()
    keyToDataUri.set(s.key, `data:image/jpeg;base64,${arrayBufferToBase64(buf)}`)
  }))

  const mdEmbedded = md.replace(
    /!\[\]\((https?:\/\/[^/]+\/([^)?]+)(?:\?[^)]*)?)\)/g,
    (match, _fullUrl: string, keyPath: string) => {
      const dataUri = keyToDataUri.get(keyPath)
      return dataUri ? `![](${dataUri})` : match
    },
  )

  // Strip YAML frontmatter — it's lecture metadata only useful inside
  // a vault (Obsidian Properties panel etc). In a standalone HTML it
  // would show as a block of literal text at the top, confusing.
  const mdNoFrontmatter = mdEmbedded.replace(/^---\n[\s\S]*?\n---\n+/, '')

  // Pre-process Obsidian-specific syntax that marked doesn't know:
  //   1. Callouts (> [!type] title)  → blockquote with emoji-prefixed title
  //   2. Block-id anchors (^abc123)  → strip (Obsidian-only)
  //   3. Wikilinks ([[term]])         → styled span (no link target in HTML)
  const mdNormalized = preprocessObsidianSyntax(mdNoFrontmatter)

  const { marked } = await import('marked')
  const htmlBodyRaw = await marked.parse(mdNormalized, { gfm: true, breaks: false })
  // All links open in a new tab so the .html viewer stays open while
  // the user jumps to the lecture video. `rel="noopener noreferrer"`
  // is the standard target=_blank security pairing — prevents the
  // opened video page from getting a back-reference to this tab.
  const htmlBodyTargetBlank = htmlBodyRaw.replace(
    /<a (href="[^"]+")/g,
    '<a $1 target="_blank" rel="noopener noreferrer"',
  )
  // Callout type styling. preprocessObsidianSyntax converts `> [!type]`
  // into `> **<emoji> title**`; marked turns that into a uniform
  // <blockquote> with a bold first line. We tag each blockquote with a
  // type-specific class based on its leading emoji so CSS can
  // differentiate definitions (yellow), summaries (green), info
  // (blue) — the visual signal that earlier was carried only by the
  // emoji glyph itself, easy to miss at a glance.
  const htmlBody = htmlBodyTargetBlank.replace(
    /<blockquote>(\s*<p><strong>)(📘|📝|ℹ️|⚠️|💡|⭐|🧪|📌|🗒️)/g,
    (_match, prefix: string, emoji: string) => {
      const cls = ({
        '📘': 'callout-definition',
        '📝': 'callout-summary',
        'ℹ️': 'callout-info',
        '⚠️': 'callout-warning',
        '💡': 'callout-tip',
        '⭐': 'callout-important',
        '🧪': 'callout-example',
        '📌': 'callout-note',
        '🗒️': 'callout-default',
      } as Record<string, string>)[emoji] ?? 'callout-default'
      return `<blockquote class="${cls}">${prefix}${emoji}`
    },
  )

  const html = wrapHtmlDocument(input.title, htmlBody)
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  triggerDownload(blob, `${safeFsName(input.title)}.html`)
}

// Obsidian uses three Markdown syntactic extensions that vanilla
// CommonMark / GFM doesn't recognise. We translate them into forms
// that `marked` understands BEFORE handing off, so the result still
// goes through one canonical Markdown renderer (rather than us hand-
// rolling HTML for arbitrary blocks and risking escaping bugs).
function preprocessObsidianSyntax(md: string): string {
  let out = md

  // 1. Callouts: `> [!type] Title` followed by `> body lines` →
  //    `> **emoji Title**\n> body lines`. Marked then renders this
  //    as a normal blockquote with a bold first line; CSS does the
  //    rest (left border colour by data-attribute is overkill here,
  //    we accept uniform styling and let the emoji disambiguate).
  const calloutEmoji: Record<string, string> = {
    info: 'ℹ️',
    summary: '📝',
    定義: '📘',
    note: '📌',
    warning: '⚠️',
    tip: '💡',
    important: '⭐',
    example: '🧪',
  }
  out = out.replace(
    /^>\s*\[!([^\]]+)\]\s*(.*)$/gm,
    (_m: string, rawType: string, title: string) => {
      const type = rawType.trim().toLowerCase()
      const emoji = calloutEmoji[type] ?? calloutEmoji[rawType.trim()] ?? '🗒️'
      const cleanTitle = title.trim() || rawType.trim()
      return `> **${emoji} ${cleanTitle}**`
    },
  )

  // 2. Block-id anchors — three forms that markdown-obsidian.ts emits:
  //      (a) `^anchor` on its own line (after H2/H3 section headings)
  //      (b) `… ^anchor` at end of bullet (important-point lines)
  //      (c) `[[#^anchor]]` block-reference wikilinks (重要事項 roll-up)
  //    All three are Obsidian transclusion targets; in flat HTML the
  //    anchors don't exist as jump destinations so they're noise.
  //
  //    The ID character class must be Unicode-aware ([\p{L}\p{N}]) —
  //    ASCII `\w` missed anchors with CJK in the slug (e.g.
  //    `s3-持続可能性-p0`), leaving raw `^…` tokens bleeding into the
  //    HTML body. (User-reported 2026-04-30.)
  //
  //    (c) MUST run before rule 3 so block-references aren't picked up
  //    by the regular wikilink conversion (which would render them as
  //    a styled span containing `#^anchor` — ugly).
  const idChars = '[\\p{L}\\p{N}_-]+'
  out = out.replace(new RegExp(`^\\^${idChars}\\s*$`, 'gmu'), '')             // (a)
  out = out.replace(new RegExp(`\\s+\\^${idChars}(?=\\s|$)`, 'gu'), '')       // (b)
  out = out.replace(new RegExp(`\\s*\\[\\[#\\^${idChars}\\]\\]`, 'gu'), '')   // (c)

  // 3. Wikilinks: `[[term]]` and `[[target|alias]]` → styled span.
  //    HTML has no vault to resolve to; treating wikilinks as plain
  //    text would lose the visual signal that these are key concepts.
  out = out.replace(
    /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
    (_m, target: string, alias: string | undefined) => {
      const display = (alias ?? target).trim()
      // Inline HTML inside markdown — marked passes raw <span> through.
      return `<span class="wikilink">${escapeHtml(display)}</span>`
    },
  )

  return out
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Self-contained HTML document. Single <style> block — no external
// fonts / scripts, so the file works offline / on phones / in any
// browser. Body width capped for readability; CJK font stack put
// first since most lectures are Japanese / Korean.
function wrapHtmlDocument(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root {
  --bg: #fafafa;
  --fg: #1f2937;
  --muted: #6b7280;
  --border: #e5e7eb;
  --accent: #2563eb;
  --quote-bg: #f1f5f9;
  --quote-border: #3b82f6;
  --code-bg: #f3f4f6;
  --wikilink: #4f46e5;
}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  background: var(--bg);
  color: var(--fg);
  font-family: "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Apple SD Gothic Neo", "Yu Gothic", "Noto Sans CJK JP", system-ui, -apple-system, sans-serif;
  /* Tightened from 1.75 — still comfortable for CJK reading. The
   * earlier value made 10-section lectures span ~7 viewport heights;
   * 1.55 brings that to ~4-5 while preserving readability. */
  line-height: 1.55;
  font-size: 16px;
}
.container {
  /* Wider reading column reduces line wraps for the verbose
   * definition / takeaway lines that dominate lecture notes. */
  max-width: 880px;
  margin: 0 auto;
  padding: 28px 24px 64px;
}
h1, h2, h3, h4 {
  line-height: 1.25;
  /* Compact heading rhythm — major time-saver for long lectures
   * where every section change was eating ~2em of whitespace. */
  margin-top: 1em;
  margin-bottom: 0.35em;
  font-weight: 700;
}
h1 {
  font-size: 1.875rem;
  border-bottom: 2px solid var(--border);
  padding-bottom: 0.3em;
  margin-top: 0;
}
h2 {
  font-size: 1.4rem;
  border-bottom: 1px solid var(--border);
  padding-bottom: 0.2em;
  margin-top: 1.4em;   /* still visually distinct from h3 */
}
h3 { font-size: 1.15rem; margin-top: 0.9em; }
p { margin: 0.4em 0; }
ul, ol { padding-left: 1.4em; margin: 0.35em 0; }
li { margin: 0.15em 0; }
hr { border: 0; border-top: 1px solid var(--border); margin: 1.2em 0; }
a {
  color: var(--accent);
  text-decoration: none;
  border-bottom: 1px solid transparent;
  transition: border-color 0.15s;
}
a:hover { border-bottom-color: var(--accent); }
blockquote {
  margin: 0.6em 0;
  padding: 8px 14px;
  background: var(--quote-bg);
  border-left: 3px solid var(--quote-border);
  border-radius: 6px;
}
blockquote p:first-child { margin-top: 0; }
blockquote p:last-child { margin-bottom: 0; }
/* Callout type styling — colour the left border + tinted background
 * by callout type (定義 / 要旨 / info / etc) so the type is readable
 * at a glance, not just by emoji. Background tints are intentionally
 * very pale so reading flow isn't disrupted on long pages.
 */
blockquote.callout-definition {
  background: #fef9c3;
  border-left-color: #ca8a04;
}
blockquote.callout-summary {
  background: #d1fae5;
  border-left-color: #059669;
}
blockquote.callout-info {
  background: #dbeafe;
  border-left-color: #2563eb;
}
blockquote.callout-warning {
  background: #fee2e2;
  border-left-color: #dc2626;
}
blockquote.callout-tip {
  background: #ede9fe;
  border-left-color: #7c3aed;
}
blockquote.callout-important {
  background: #fce7f3;
  border-left-color: #db2777;
}
blockquote.callout-example {
  background: #e0e7ff;
  border-left-color: #4f46e5;
}
blockquote.callout-note {
  background: #f3f4f6;
  border-left-color: #6b7280;
}
/* Slides — large lecture screenshots that easily ate a whole viewport
 * each. Cap height at 50% of screen and keep aspect ratio so a
 * 10-slide section is browsable without endless scrolling.
 */
img {
  max-width: 100%;
  max-height: 50vh;
  width: auto;
  height: auto;
  border-radius: 6px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  display: block;
  margin: 0.4em auto;
}
code {
  background: var(--code-bg);
  padding: 0.1em 0.4em;
  border-radius: 4px;
  font-size: 0.92em;
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}
pre {
  background: var(--code-bg);
  padding: 12px 14px;
  border-radius: 6px;
  overflow-x: auto;
}
pre code {
  background: transparent;
  padding: 0;
}
.wikilink {
  color: var(--wikilink);
  font-weight: 500;
  border-bottom: 1px dotted var(--wikilink);
}
/* Slide timestamp annotation that the markdown emits */
.slide-ts {
  display: inline-block;
  margin-left: 8px;
  font-size: 0.75rem;
  color: var(--muted);
  font-weight: 500;
}

/* PDF 저장 button — fixed top-right of the screen so it's always
 * visible while scrolling. Hidden when printing so it doesn't appear
 * in the resulting PDF.
 */
.pdf-button {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 10;
  background: var(--accent);
  color: white;
  border: none;
  border-radius: 8px;
  padding: 10px 16px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);
  transition: transform 0.15s, box-shadow 0.15s;
  font-family: inherit;
}
.pdf-button:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(37, 99, 235, 0.4);
}
.pdf-button:active { transform: translateY(0); }

/* Print: cleaner output when user does Cmd+P → Save as PDF.
 * Page-break rules here are the ones that matter for a long lecture
 * note; the order is: page setup → wide-impact resets → element-level
 * rules. Each rule has the modern break-* and the legacy
 * page-break-* form for older Chromium / Safari.
 */
@page {
  /* A4 with comfortable margins. Browsers may override based on user
   * preference in the print dialog, but the default looks proper.
   */
  size: A4;
  margin: 18mm 16mm;
}
@media print {
  body {
    background: white;
    /* Slightly tighter line-height saves a page or two on long
     * lectures without crunching readability.
     */
    line-height: 1.55;
  }
  .container {
    max-width: none;
    padding: 0;
  }
  .pdf-button { display: none !important; }
  a {
    color: var(--fg);
    border-bottom: none;
  }
  /* Image-cut-in-half is the most common print complaint. Force the
   * whole image onto one page; if it doesn't fit at full width the
   * browser will scale it down or page-break BEFORE.
   */
  img {
    box-shadow: none;
    break-inside: avoid;
    page-break-inside: avoid;
    /* Cap height so a 1280×720 slide doesn't take a whole page when
     * the surrounding text would fit too. Aspect ratio preserved.
     */
    max-height: 75vh;
    width: auto;
  }
  /* Definition / summary callouts — keep them whole so the reader
   * isn't stitching two halves together.
   */
  blockquote {
    break-inside: avoid;
    page-break-inside: avoid;
  }
  /* Heading orphans: never end a page with a heading whose body is
   * on the next page. break-after avoid keeps the next block on
   * the same page when possible.
   */
  h1, h2, h3, h4 {
    break-after: avoid;
    page-break-after: avoid;
  }
  /* List items shouldn't break mid-bullet — looks awful and the
   * reader loses context.
   */
  li {
    break-inside: avoid;
    page-break-inside: avoid;
  }
  /* General orphan/widow control: never leave 1-2 lines stranded at
   * the top or bottom of a page. 3 is the typographer default.
   */
  p, li, blockquote {
    orphans: 3;
    widows: 3;
  }
  /* The HR between sections is a natural break point. Don't FORCE a
   * page break (would waste paper for short sections), but allow
   * the browser to prefer one here when it's deciding.
   */
  hr {
    border-top-color: transparent;
  }
}
</style>
</head>
<body>
<button class="pdf-button" onclick="window.print()" aria-label="${escapeHtml(t().export.pdfButtonAria)}">${escapeHtml(t().export.pdfButton)}</button>
<div class="container">
${bodyHtml}
</div>
</body>
</html>`
}

// Fast browser-safe base64 of an ArrayBuffer. Avoids `btoa(String.fromCharCode(...))`
// which blows the stack on >100 KB inputs (each slide is ~150-300 KB).
// Chunks the bytes into 32 KB windows and joins.
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)))
  }
  return btoa(binary)
}

// Re-fetch the session JSON at export time. The frontend's React state
// holds slides with presigned URLs from when the modal opened — those
// URLs have a 1 h TTL on the backend (presignGet), so a user who opens
// the modal in the morning and exports in the afternoon hits 403 on
// every slide fetch. Always pull fresh URLs at export time. The
// returned `key` field is the stable S3 path used for matching the
// URLs embedded in the markdown.
async function fetchFreshSlides(sourceUrl: string): Promise<SlideItem[]> {
  const token = await getToken()
  const r = await fetch(
    `${API_BASE_URL}/v1/session?url=${encodeURIComponent(sourceUrl)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!r.ok) throw new Error(`session refresh failed: ${r.status}`)
  const data = await r.json() as { session: { slides?: SlideItem[] } | null }
  return data.session?.slides ?? []
}

// Build a zip whose ENTIRE content is one folder — `<title>/` —
// containing the markdown file and every slide image flat next to it:
//
//   <title>.zip
//     └── <title>/
//         ├── <title>.md
//         ├── slide-00-02.jpg
//         ├── slide-00-03.jpg
//         └── …
//
// Why this layout: previous version used Obsidian's `Attachments/...`
// convention with a deep nested per-app path under `Attachments/`,
// which forced the user to either preserve that whole hierarchy or
// manually re-create it in their vault — confusing first-time users.
// Putting everything in one self-contained folder reduces the user's
// step count to literally "drag the folder into vault". Image refs in
// the markdown become bare filenames (`![](slide-00-02.jpg)`) which
// resolve relative to the .md's own folder — Obsidian's default
// behavior, no special configuration needed.
//
// We fetch slides in PARALLEL via Promise.all — the browser caps
// simultaneous connections to ~6 per host so this self-throttles
// without blowing up.
export async function exportZip(input: ExportInput): Promise<void> {
  const { title } = input

  // Refresh slides + markdown in parallel. Both calls hit
  // /v1/session and presign URLs server-side; doing them at export
  // time guarantees the URLs are well within their 1 h validity
  // window. The slides response gives us the stable S3 keys we use
  // to rewrite the markdown's image refs to local attachment paths.
  const [mdRaw, slides] = await Promise.all([
    fetchMarkdown(input.sourceUrl),
    fetchFreshSlides(input.sourceUrl),
  ])
  // Sync the H1 with the (possibly user-edited) filename title.
  const md = rewriteFirstH1(mdRaw, title)

  // Lazy-load fflate so the library only ships to users who actually
  // export. ~14 KB minified.
  const { zipSync } = await import('fflate')

  const folderName = safeFsName(title)
  const slideNames = buildSlideFilenames(slides)
  const slideBlobs = await Promise.all(
    slides.map(async (s, i) => {
      const r = await fetch(s.url)
      if (!r.ok) throw new Error(`slide ${slideNames[i]} fetch ${r.status}`)
      return new Uint8Array(await r.arrayBuffer())
    }),
  )

  // Rewrite slide image refs in the markdown to BARE filenames so they
  // resolve relative to the .md (which sits in the same folder as the
  // slides). We match by the URL's path component (= the stable S3
  // key) since the presigned URLs in the markdown text were signed by
  // a separate /v1/session?format=markdown call and have different
  // X-Amz-Signature query strings than the ones in `slides[].url`.
  const keyToFilename = new Map<string, string>()
  for (let i = 0; i < slides.length; i++) {
    keyToFilename.set(slides[i].key, slideNames[i])
  }
  const mdRewritten = md.replace(
    /!\[\]\((https?:\/\/[^/]+\/([^)?]+)(?:\?[^)]*)?)\)/g,
    (match, _fullUrl: string, keyPath: string) => {
      const filename = keyToFilename.get(keyPath)
      return filename ? `![](${filename})` : match
    },
  )

  // Single top-level folder in the zip = predictable extraction across
  // platforms (macOS auto-creates a wrapper for multi-top-file zips,
  // Windows / Linux unzip put everything in cwd; both behaviours
  // converge to the same folder when our zip already wraps).
  const entries: Record<string, Uint8Array> = {
    [`${folderName}/${folderName}.md`]: new TextEncoder().encode(mdRewritten),
  }
  for (let i = 0; i < slides.length; i++) {
    entries[`${folderName}/${slideNames[i]}`] = slideBlobs[i]
  }
  const zipBytes = zipSync(entries, { level: 6 })
  const zipBlob = new Blob([zipBytes as unknown as ArrayBuffer], { type: 'application/zip' })
  triggerDownload(zipBlob, `${folderName}.zip`)
}

// ──────────────────────────────────────────────────────────────────────
// v0.3 — Obsidian Local REST API push
// ──────────────────────────────────────────────────────────────────────
//
// Pushes the lecture artifact straight into the user's Obsidian vault
// via the Local REST API plugin (community plugin: obsidian-local-rest-
// api). Requirements on the user side:
//   1. Install the plugin in Obsidian
//   2. Enable HTTP at port 27123 in plugin settings (HTTPS uses self-
//      signed cert which Chrome rejects without manual exception)
//   3. Copy the API key + paste into Lisna Options
//
// What we PUT: same self-contained folder structure as exportZip but
// landed directly in vault — `<folder>/<title>/<title>.md` plus
// `<folder>/<title>/slide-MM-SS.jpg` next to it. The user opens
// Obsidian and the lecture is already there.

interface ObsidianSyncResult {
  ok: boolean
  files: number
  durationMs: number
  error?: string
}

// Connection test: GET /vault/ returns the vault root listing when
// auth + network are wired correctly. Used by the Options page
// "接続テスト" button so the user gets immediate, actionable feedback
// BEFORE depending on the config for actual lecture sync.
//
// Error messages are tuned to the THREE failure modes the user will
// actually hit:
//   1. Plugin not installed / server OFF        → connection refused
//   2. Wrong API key                            → 401 Unauthorized
//   3. Wrong URL or unsupported plugin version  → 404 / other 4xx-5xx
// Surfacing each as plain Japanese saves the user from googling raw
// status codes / "Failed to fetch" browser-isms.
export async function testObsidianConnection(cfg: ObsidianConfig): Promise<{ ok: boolean; error?: string }> {
  const T = t().options
  if (!cfg.apiUrl) return { ok: false, error: T.obsidian_test_apiUrl_empty }
  if (!cfg.apiKey) return { ok: false, error: T.obsidian_test_apiKey_empty }
  let r: Response
  try {
    r = await fetch(joinUrl(cfg.apiUrl, '/vault/'), {
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    // eslint-disable-next-line no-console
    console.warn('[obsidian] connection test threw:', e)
    if (msg.includes('Failed to fetch') || msg.toLowerCase().includes('networkerror')) {
      return { ok: false, error: T.obsidian_test_network }
    }
    return { ok: false, error: msg }
  }

  if (r.ok) return { ok: true }
  if (r.status === 401 || r.status === 403) {
    return { ok: false, error: T.obsidian_test_unauth }
  }
  if (r.status === 404) {
    return { ok: false, error: T.obsidian_test_404 }
  }
  return { ok: false, error: `HTTP ${r.status} ${r.statusText || ''}`.trim() }
}

export async function pushToObsidian(input: ExportInput): Promise<ObsidianSyncResult> {
  const t0 = performance.now()
  const T = t().options
  const cfg = await getObsidianConfig()
  if (!cfg.apiUrl || !cfg.apiKey) {
    return { ok: false, files: 0, durationMs: 0, error: T.obsidian_unconfigured }
  }

  const [mdRaw, slides] = await Promise.all([
    fetchMarkdown(input.sourceUrl),
    fetchFreshSlides(input.sourceUrl),
  ])
  const md0 = rewriteFirstH1(mdRaw, input.title)

  // Same folder layout as the .zip export: <title>/<title>.md +
  // <title>/slide-XX-XX.jpg flat. Inside the folder the markdown's
  // image refs are bare filenames, so they resolve relative to the
  // .md once the user opens it in Obsidian. The vault-relative
  // parent folder (cfg.folder) is prepended so users can park
  // lectures under e.g. "Lectures/2026春/" without polluting root.
  const folderName = safeFsName(input.title)
  const slideNames = buildSlideFilenames(slides)
  const keyToFilename = new Map<string, string>()
  for (let i = 0; i < slides.length; i++) keyToFilename.set(slides[i].key, slideNames[i])
  const md = md0.replace(
    /!\[\]\((https?:\/\/[^/]+\/([^)?]+)(?:\?[^)]*)?)\)/g,
    (m, _u: string, k: string) => {
      const fn = keyToFilename.get(k)
      return fn ? `![](${fn})` : m
    },
  )

  // Build the vault path. Trim leading/trailing slashes from cfg.folder
  // so we don't end up with `//Lectures///title.md` style paths the
  // plugin rejects.
  const baseFolder = cfg.folder.replace(/^\/+|\/+$/g, '')
  const lectureFolder = baseFolder ? `${baseFolder}/${folderName}` : folderName

  // Upload markdown first. PUT /vault/{path} either creates or
  // overwrites — perfect for re-syncing after a re-curate (the user
  // gets the latest outline, not duplicates piling up).
  const headers = { Authorization: `Bearer ${cfg.apiKey}` }
  const mdRes = await fetch(joinUrl(cfg.apiUrl, `/vault/${encodeVaultPath(lectureFolder)}/${encodeVaultPath(folderName)}.md`), {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'text/markdown' },
    body: md,
  })
  if (!mdRes.ok) {
    return { ok: false, files: 0, durationMs: performance.now() - t0, error: interpolate(T.obsidian_markdownPutFail, { status: mdRes.status }) }
  }

  // Upload slides in parallel. Browser caps to ~6 concurrent so this
  // self-throttles without overwhelming the local Obsidian process.
  let slideErrorCount = 0
  await Promise.all(slides.map(async (s, i) => {
    try {
      const buf = await (await fetch(s.url)).arrayBuffer()
      const r = await fetch(joinUrl(cfg.apiUrl, `/vault/${encodeVaultPath(lectureFolder)}/${encodeVaultPath(slideNames[i])}`), {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'image/jpeg' },
        body: buf,
      })
      if (!r.ok) slideErrorCount++
    } catch { slideErrorCount++ }
  }))

  return {
    ok: slideErrorCount === 0,
    files: 1 + (slides.length - slideErrorCount),
    durationMs: performance.now() - t0,
    ...(slideErrorCount > 0 ? { error: interpolate(T.obsidian_slidesSendFail, { n: slideErrorCount }) } : {}),
  }
}

function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, '') + (path.startsWith('/') ? path : `/${path}`)
}

// Encode each path segment for safe inclusion in a URL while keeping
// the slashes between segments. encodeURIComponent on the whole path
// would mangle the slashes; raw concatenation breaks if a segment
// contains spaces or non-ASCII characters.
function encodeVaultPath(path: string): string {
  return path.split('/').filter(Boolean).map(encodeURIComponent).join('/')
}
