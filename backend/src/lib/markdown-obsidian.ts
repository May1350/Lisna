// Obsidian-flavored Markdown formatter for the curator's Outline.
//
// This is the SECOND renderer of the same source-of-truth Outline JSON.
// The first renderer is the React OutlineView in the extension modal,
// which intentionally hides all markdown syntax (read-only-friendly UI).
// This one targets a student's Obsidian / Logseq / Notion vault and
// emits the full set of conventions:
//
//   - YAML frontmatter (queryable by Dataview / similar plugins)
//   - [[wikilinks]] for every key term, course, lecturer (auto-graph)
//   - > [!定義] / > [!info] callouts (Obsidian's native admonitions)
//   - ^block-id anchors so the student can transclude a single bullet
//   - [▶ 1:05](url&t=65) deep-links back into the source video
//   - 学習チェックリスト section with check_questions for spaced review
//
// Design notes:
//   - We never trust LLM-emitted text contains valid Obsidian syntax
//     literally — sanitise wikilink targets (no [, ], |, ^, # in the
//     text) so the resulting [[…]] doesn't accidentally break.
//   - Block IDs are deterministic from section index + slug so the same
//     outline produces the same anchors across re-exports.
//   - Time-deep-link URL is built from the session URL with `&t=Xs`
//     appended (works on YouTube, K-LMS, most HTML5 video pages).

import type { Outline, OutlineSection } from './curator.js'

export interface ExportContext {
  /** Original lecture / video URL — used to build [▶ time] deep links. */
  sourceUrl: string
  /** Session id (UUID) for the YAML frontmatter. */
  sessionId: string
  /** When this export was generated. */
  generatedAt?: Date
  /** ISO date for the lecture, if known. Defaults to today. */
  lectureDate?: string
  /** Total recorded duration in seconds (optional, formatted as h:mm:ss). */
  durationSec?: number
  /** Tags to add to frontmatter beyond the auto-derived ones. */
  extraTags?: string[]
  /** Captured slides with fresh presigned URLs. Slides whose ts falls
   *  inside a section's [ts, nextSection.ts) range get embedded as
   *  `![](url)` inline at the top of that section's body. The bare-alt
   *  pattern matches the extension's export.ts regex which rewrites
   *  these to local filenames during the zip export. */
  slides?: { ts: number; url: string; key: string }[]
}

export function outlineToObsidianMarkdown(o: Outline, ctx: ExportContext): string {
  const lines: string[] = []

  // ── 1. YAML frontmatter ────────────────────────────────────────────────
  lines.push(...frontmatter(o, ctx))
  lines.push('')

  // ── 2. H1 + 講義情報 callout ───────────────────────────────────────────
  lines.push(`# ${escapeHeadingText(o.title || 'Untitled lecture')}`)
  lines.push('')
  lines.push('> [!info] 講義情報')
  if (o.lecturer)  lines.push(`> - 教授: [[${sanitiseWikilink(o.lecturer)}]]`)
  if (o.course)    lines.push(`> - 科目: [[${sanitiseWikilink(o.course)}]]`)
  if (ctx.lectureDate) lines.push(`> - 視聴日: ${ctx.lectureDate}`)
  if (ctx.durationSec) lines.push(`> - 長さ: ${formatHHMMSS(ctx.durationSec)}`)
  lines.push(`> - [▶ 動画を開く](${ctx.sourceUrl})`)
  lines.push('')

  // ── 3. TL;DR (if curator emitted one) ─────────────────────────────────
  if (o.tldr) {
    lines.push('## TL;DR')
    lines.push(autoLinkTerms(o.tldr, collectTerms(o)))
    lines.push('')
  }

  // ── 4. 重要事項 roll-up — every section's important points up top ─────
  const importantPoints = collectImportantPoints(o, ctx.sourceUrl)
  if (importantPoints.length > 0) {
    lines.push('## 重要事項 ⭐')
    for (const p of importantPoints) lines.push(p)
    lines.push('')
  }

  // ── 5. Per-section detail ─────────────────────────────────────────────
  o.sections.forEach((s, i) => {
    lines.push(...sectionBlock(s, i, ctx, o.sections))
    lines.push('')
  })

  // ── 6. 関連リンク (related lectures / outline-level links) ────────────
  if (o.related_lectures && o.related_lectures.length > 0) {
    lines.push('## 関連リンク')
    for (const r of o.related_lectures) {
      lines.push(`- [[${sanitiseWikilink(r)}]]`)
    }
    lines.push('')
  }

  // ── 7. 用語インデックス (atomic-note seeds) ────────────────────────────
  const allTerms = collectTerms(o)
  if (allTerms.length > 0) {
    lines.push('## 用語インデックス')
    for (const t of allTerms) lines.push(`- [[${sanitiseWikilink(t)}]]`)
    lines.push('')
  }

  // ── 8. 学習チェックリスト ─────────────────────────────────────────────
  const checklist = collectCheckQuestions(o)
  if (checklist.length > 0) {
    lines.push('## 学習チェックリスト')
    for (const q of checklist) lines.push(`- [ ] ${q}`)
    lines.push('')
  }

  return lines.join('\n')
}

// ──────────────────────────────────────────────────────────────────────
// Section block: heading → callout(定義 if key_terms) → 用例 / 重要 / 補足
// ──────────────────────────────────────────────────────────────────────

function sectionBlock(s: OutlineSection, idx: number, ctx: ExportContext, allSections: OutlineSection[]): string[] {
  const out: string[] = []
  const blockId = sectionBlockId(s, idx)
  const terms = collectTerms({ title: '', sections: [s] })

  // Heading: link the first term as wikilink so navigation works
  const headingTermLink = s.key_terms[0]
    ? `[[${sanitiseWikilink(s.key_terms[0].term)}]] (${escapeHeadingText(s.heading)})`
    : escapeHeadingText(s.heading)
  out.push(`## ${headingTermLink}`)
  out.push(`^${blockId}`)
  out.push('')

  if (s.takeaway) {
    out.push(`> [!summary] 要旨`)
    out.push(`> ${autoLinkTerms(s.takeaway, terms)}`)
    out.push('')
  }

  // Slide images for this section. Time-based bucket: every slide whose
  // ts falls in [s.ts, nextSection.ts) lands here, sorted by ts. The
  // first section also collects any slides captured BEFORE its own ts
  // (e.g. very early slides while the model was still settling on a
  // section boundary) so no captured slide is silently dropped.
  const sectionSlides = slidesForSection(s, idx, allSections, ctx.slides ?? [])
  if (sectionSlides.length > 0) {
    for (const sl of sectionSlides) {
      out.push(`![](${sl.url})`)
      out.push(`*${deepLink(ctx.sourceUrl, sl.ts)}*`)
      out.push('')
    }
  }

  // Definitions: one callout per key_term
  if (s.key_terms.length > 0) {
    for (const kt of s.key_terms) {
      out.push(`> [!定義] ${kt.term}`)
      out.push(`> ${kt.definition}`)
      out.push('')
    }
  }

  // 用例 (transcript-cited examples)
  if (s.examples.length > 0) {
    out.push('**用例**')
    for (const e of s.examples) {
      out.push(`- ${escapeText(e.text)} ${deepLink(ctx.sourceUrl, e.ts)}`)
    }
    out.push('')
  }

  // 重要ポイント (★) — hoisted below callouts so they stand out
  const star = s.points.filter(p => p.important)
  const others = s.points.filter(p => !p.important)
  if (star.length > 0) {
    out.push('**重要ポイント**')
    star.forEach((p, j) => {
      const localId = `${blockId}-p${j}`
      out.push(`- ⭐ **${autoLinkTerms(p.text, terms)}** ${deepLink(ctx.sourceUrl, p.ts)} ^${localId}`)
    })
    out.push('')
  }

  // 補足 (non-important points)
  if (others.length > 0) {
    out.push('**補足**')
    for (const p of others) {
      out.push(`- ${autoLinkTerms(p.text, terms)} ${deepLink(ctx.sourceUrl, p.ts)}`)
    }
    out.push('')
  }

  // 関連用語 (within section — promotes graph density)
  if (s.related_terms && s.related_terms.length > 0) {
    const links = s.related_terms.map(t => `[[${sanitiseWikilink(t)}]]`).join(' | ')
    out.push(`**関連用語**: ${links}`)
    out.push('')
  }

  out.push('---')
  return out
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

function frontmatter(o: Outline, ctx: ExportContext): string[] {
  const date = ctx.lectureDate ?? new Date().toISOString().slice(0, 10)
  const tags = [
    'lecture',
    'study-helper',
    ...(ctx.extraTags ?? []),
  ]
  // YAML scalar quoting: prefer block-style strings if they contain : or # to
  // avoid YAML parser confusion. Simple values stay unquoted.
  const lines = ['---', 'type: lecture-note']
  if (o.course)    lines.push(`course: "[[${sanitiseWikilink(o.course)}]]"`)
  if (o.lecturer)  lines.push(`lecturer: "[[${sanitiseWikilink(o.lecturer)}]]"`)
  lines.push(`date: ${date}`)
  if (ctx.durationSec) lines.push(`duration: "${formatHHMMSS(ctx.durationSec)}"`)
  lines.push(`source: "${ctx.sourceUrl}"`)
  lines.push(`session_id: ${ctx.sessionId}`)
  lines.push(`tags: [${tags.map(t => quoteIfNeeded(t)).join(', ')}]`)
  lines.push(`generated_by: study-helper`)
  if (ctx.generatedAt) lines.push(`generated_at: ${ctx.generatedAt.toISOString()}`)
  lines.push('---')
  return lines
}

function quoteIfNeeded(s: string): string {
  return /^[a-zA-Z0-9_-]+$/.test(s) ? s : `"${s.replace(/"/g, '\\"')}"`
}

function collectImportantPoints(o: Outline, sourceUrl: string): string[] {
  const out: string[] = []
  const allTerms = collectTerms(o)
  o.sections.forEach((s, i) => {
    const blockId = sectionBlockId(s, i)
    s.points.filter(p => p.important).forEach((p, j) => {
      const localId = `${blockId}-p${j}`
      out.push(`- **${autoLinkTerms(p.text, allTerms)}** [[#^${localId}]] ${deepLink(sourceUrl, p.ts)}`)
    })
  })
  return out
}

function collectTerms(o: Outline): string[] {
  const set = new Set<string>()
  for (const s of o.sections) for (const kt of s.key_terms) if (kt.term) set.add(kt.term)
  return Array.from(set)
}

function collectCheckQuestions(o: Outline): string[] {
  return o.sections.map(s => s.check_question).filter((q): q is string => !!q && !!q.trim())
}

function slidesForSection(
  s: OutlineSection,
  idx: number,
  allSections: OutlineSection[],
  slides: { ts: number; url: string; key: string }[],
): { ts: number; url: string; key: string }[] {
  if (slides.length === 0) return []
  // Section range: [s.ts, nextSection.ts). The first section also picks
  // up any slide captured before it (ts < s.ts) — usually a tiny number
  // and dropping them silently would surprise the user.
  const start = idx === 0 ? -Infinity : s.ts
  const end = idx + 1 < allSections.length ? allSections[idx + 1].ts : Infinity
  return slides
    .filter(sl => sl.ts >= start && sl.ts < end)
    .sort((a, b) => a.ts - b.ts)
}

function sectionBlockId(s: OutlineSection, idx: number): string {
  // Deterministic anchor: section index + ASCII slug of first term/heading.
  // Falls back to plain numeric so the anchor is always valid.
  const firstTerm = s.key_terms[0]?.term ?? s.heading ?? ''
  const slug = firstTerm
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
  return `s${idx + 1}${slug ? '-' + slug : ''}`
}

function deepLink(sourceUrl: string, ts: number): string {
  // Build a "&t=NNs" deep link. Append vs replace based on existing query.
  // YouTube uses &t= ; some LMS players ignore it but the link still opens
  // the video page. K-LMS deep-time-anchors aren't standard, so this is
  // best-effort for non-YouTube sources.
  const sep = sourceUrl.includes('?') ? '&' : '?'
  const linked = `${sourceUrl}${sep}t=${Math.max(0, Math.floor(ts))}s`
  return `[▶ ${formatMMSS(ts)}](${linked})`
}

/** Auto-replaces occurrences of any term in `terms` with [[term]] in `text`,
 *  longest-first so "持続可能性" doesn't get broken into [[持続]]可能性 by a
 *  shorter match. Idempotent — won't double-link an already wikilinked term.
 *
 *  Performance: builds a single combined alternation regex (sorted by length
 *  DESC, since regex alternation is left-greedy this preserves longest-match
 *  precedence) and walks the body in one pass instead of N passes for N
 *  terms. */
function autoLinkTerms(text: string, terms: string[]): string {
  if (!text || terms.length === 0) return escapeText(text)
  const sorted = [...new Set(terms)]
    .filter(t => t && t.length >= 2)
    .sort((a, b) => b.length - a.length)
  if (sorted.length === 0) return escapeText(text)
  const escapedAlternatives = sorted.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  // Skip terms already wrapped in [[…]] to avoid double-bracket. The
  // alternation is left-greedy in JS regex — sorted DESC by length means
  // the longest viable match wins, identical to the per-term loop's
  // longest-first ordering.
  const combined = new RegExp(`(?<!\\[\\[)(?:${escapedAlternatives.join('|')})(?!\\]\\])`, 'g')
  return text.replace(combined, (match) => `[[${sanitiseWikilink(match)}]]`)
}

/** Strip characters that would break Obsidian wikilink syntax. */
function sanitiseWikilink(s: string): string {
  return s.replace(/[\[\]|^#]/g, '').trim()
}

/** Escape special characters in regular text — currently a no-op for
 *  Japanese content but factored out so we have one place to add MD
 *  escapes if we ever need them. */
function escapeText(s: string): string {
  return s
}

function escapeHeadingText(s: string): string {
  return s.replace(/[\r\n]+/g, ' ').trim()
}

function formatMMSS(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function formatHHMMSS(secs: number): string {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = Math.floor(secs % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
