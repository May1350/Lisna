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

// Per-language heading / label set. The curator emits prose in the
// chosen note language but our markdown skeleton has its own headings
// (TL;DR, 重要事項, 関連リンク, 学習チェックリスト, 講義情報, etc.)
// — those need to match the same language so the doc reads as one
// coherent piece. Falls through to Japanese for unknown / 'auto'
// since 'auto' means "the curator picked from transcript", and we
// can't easily detect the curator's choice from JSON output. Users
// who set note_language explicitly get matching headings.
type MarkdownLocale = 'ja' | 'en' | 'ko' | 'zh'
interface HeadingSet {
  info_callout: string
  tldr_h2: string
  important_h2: string
  related_h2: string
  checklist_h2: string
  summary_callout: string
  definition_callout: string
  slides_label: string
  terms_label: string
  points_label: string
  examples_inline_prefix: string
  related_inline: string
  professor: string
  course: string
  watchedDate: string
  duration: string
  openVideo: string
  videoTimeArrow: string
  inferred_callout: string
  steps_label: string
  formula_label: string
  argument_label: string
  timeline_label: string
}
const HEADINGS: Record<MarkdownLocale, HeadingSet> = {
  ja: {
    info_callout: '講義情報', tldr_h2: 'TL;DR', important_h2: '重要事項 ⭐',
    related_h2: '関連リンク', checklist_h2: '学習チェックリスト',
    summary_callout: '要旨', definition_callout: '定義',
    slides_label: 'スライド', terms_label: '用語', points_label: 'ポイント',
    examples_inline_prefix: '例', related_inline: '関連',
    professor: '教授', course: '科目', watchedDate: '視聴日', duration: '長さ',
    openVideo: '▶ 動画を開く', videoTimeArrow: '▶',
    inferred_callout: '補足', steps_label: '手順', formula_label: '公式',
    argument_label: '論証', timeline_label: '時系列',
  },
  en: {
    info_callout: 'Lecture info', tldr_h2: 'TL;DR', important_h2: 'Key points ⭐',
    related_h2: 'Related lectures', checklist_h2: 'Study checklist',
    summary_callout: 'Summary', definition_callout: 'Definition',
    slides_label: 'Slides', terms_label: 'Terms', points_label: 'Points',
    examples_inline_prefix: 'e.g.', related_inline: 'Related',
    professor: 'Professor', course: 'Course', watchedDate: 'Watched', duration: 'Length',
    openVideo: '▶ Open video', videoTimeArrow: '▶',
    inferred_callout: 'Note', steps_label: 'Steps', formula_label: 'Formula',
    argument_label: 'Argument', timeline_label: 'Timeline',
  },
  ko: {
    info_callout: '강의 정보', tldr_h2: 'TL;DR', important_h2: '중요사항 ⭐',
    related_h2: '관련 링크', checklist_h2: '학습 체크리스트',
    summary_callout: '요지', definition_callout: '정의',
    slides_label: '슬라이드', terms_label: '용어', points_label: '핵심',
    examples_inline_prefix: '예', related_inline: '관련',
    professor: '교수', course: '과목', watchedDate: '시청일', duration: '길이',
    openVideo: '▶ 영상 열기', videoTimeArrow: '▶',
    inferred_callout: '보충', steps_label: '절차', formula_label: '공식',
    argument_label: '논증', timeline_label: '시간 순',
  },
  zh: {
    info_callout: '讲座信息', tldr_h2: 'TL;DR', important_h2: '重点 ⭐',
    related_h2: '相关链接', checklist_h2: '学习清单',
    summary_callout: '要点', definition_callout: '定义',
    slides_label: '幻灯片', terms_label: '术语', points_label: '要点',
    examples_inline_prefix: '例', related_inline: '相关',
    professor: '教授', course: '课程', watchedDate: '观看日期', duration: '时长',
    openVideo: '▶ 打开视频', videoTimeArrow: '▶',
    inferred_callout: '补充', steps_label: '步骤', formula_label: '公式',
    argument_label: '论证', timeline_label: '时间线',
  },
}

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
  /** Captured slides for this session. When present, each slide's
   *  thumbnail is embedded inline in the section whose ts range it
   *  falls in. Renderer emits `![](presignedUrl)` form; the zip-export
   *  path on the frontend rewrites those URLs to local
   *  `Attachments/Study-Helper/<sess>/slide-mm-ss.jpg` paths so the
   *  references resolve once unpacked into a vault. */
  slides?: { ts: number; key: string; url: string }[]
  /** Locale for the markdown skeleton (callouts, section headings,
   *  frontmatter labels). The curator-emitted prose stays in whatever
   *  language it was generated in; this only controls the ENVELOPE
   *  text we add around it. Falls back to 'ja' when omitted (legacy). */
  lang?: MarkdownLocale
}

function H(ctx: ExportContext): HeadingSet {
  return HEADINGS[ctx.lang ?? 'ja']
}

export function outlineToObsidianMarkdown(o: Outline, ctx: ExportContext): string {
  const lines: string[] = []
  const h = H(ctx)

  lines.push(...frontmatter(o, ctx))
  lines.push('')

  lines.push(`# ${escapeHeadingText(o.title || 'Untitled lecture')}`)
  lines.push('')
  lines.push(`> [!info] ${h.info_callout}`)
  if (isMeaningful(o.lecturer)) lines.push(`> - ${h.professor}: [[${sanitiseWikilink(o.lecturer!)}]]`)
  if (isMeaningful(o.course))   lines.push(`> - ${h.course}: [[${sanitiseWikilink(o.course!)}]]`)
  if (ctx.lectureDate) lines.push(`> - ${h.watchedDate}: ${ctx.lectureDate}`)
  if (ctx.durationSec) lines.push(`> - ${h.duration}: ${formatHHMMSS(ctx.durationSec)}`)
  lines.push(`> - [${h.openVideo}](${ctx.sourceUrl})`)
  lines.push('')

  if (o.tldr) {
    lines.push(`## ${h.tldr_h2}`)
    lines.push(autoLinkTerms(o.tldr, collectTerms(o)))
    lines.push('')
  }

  const importantPoints = collectImportantPoints(o, ctx.sourceUrl)
  if (importantPoints.length > 0) {
    lines.push(`## ${h.important_h2}`)
    for (const p of importantPoints) lines.push(p)
    lines.push('')
  }

  const slideBuckets = bucketSlidesBySection(o.sections, ctx.slides ?? [])
  o.sections.forEach((s, i) => {
    lines.push(...sectionBlock(s, i, ctx, slideBuckets[i]))
    lines.push('')
  })

  if (o.related_lectures && o.related_lectures.length > 0) {
    lines.push(`## ${h.related_h2}`)
    for (const r of o.related_lectures) {
      lines.push(`- [[${sanitiseWikilink(r)}]]`)
    }
    lines.push('')
  }

  const checklist = collectCheckQuestions(o)
  if (checklist.length > 0) {
    lines.push(`## ${h.checklist_h2}`)
    for (const q of checklist) lines.push(`- [ ] ${q}`)
    lines.push('')
  }

  return lines.join('\n')
}

// ──────────────────────────────────────────────────────────────────────
// Section block: heading → callout(定義 if key_terms) → 用例 / 重要 / 補足
// ──────────────────────────────────────────────────────────────────────

function sectionBlock(
  s: OutlineSection,
  idx: number,
  ctx: ExportContext,
  slidesInSection: { ts: number; key: string; url: string }[] = [],
): string[] {
  const out: string[] = []
  const h = H(ctx)
  const blockId = sectionBlockId(s, idx)
  const terms = collectTerms({ title: '', sections: [s] })

  const headingTermLink = s.key_terms[0]
    ? `[[${sanitiseWikilink(s.key_terms[0].term)}]] (${escapeHeadingText(s.heading)})`
    : escapeHeadingText(s.heading)
  out.push(`## ${headingTermLink}`)
  out.push(`^${blockId}`)
  out.push('')

  if (s.takeaway) {
    out.push(`> [!summary] ${h.summary_callout}`)
    out.push(`> ${autoLinkTerms(s.takeaway, terms)}`)
    out.push('')
  }

  if (slidesInSection.length > 0) {
    out.push(`**${h.slides_label}**`)
    for (const slide of slidesInSection) {
      out.push(`- ![](${slide.url}) <span class="slide-ts">@ ${formatHHMMSS(slide.ts)}</span> ${deepLink(ctx.sourceUrl, slide.ts)}`)
    }
    out.push('')
  }

  if (s.key_terms.length > 0) {
    out.push(`**${h.terms_label}**`)
    for (const kt of s.key_terms) {
      if (kt.from === 'inferred') {
        out.push(`> [!note] ${h.inferred_callout} — ※ ${kt.term}`)
        out.push(`> ${kt.definition}`)
        out.push('')
      } else {
        out.push(`- **${kt.term}**: ${kt.definition}`)
      }
    }
    out.push('')
  }

  const importantPoints = s.points.filter(p => p.important)
  const otherPoints = s.points.filter(p => !p.important)
  if (importantPoints.length > 0 || otherPoints.length > 0 || s.examples.length > 0) {
    out.push(`**${h.points_label}**`)
    importantPoints.forEach((p, j) => {
      if (p.from === 'inferred') {
        out.push(`> [!note] ${h.inferred_callout}`)
        out.push(`> ※ ${p.text}`)
        out.push('')
      } else {
        const localId = `${blockId}-p${j}`
        out.push(`- ⭐ **${autoLinkTerms(p.text, terms)}** ${deepLink(ctx.sourceUrl, p.ts)} ^${localId}`)
      }
    })
    for (const p of otherPoints) {
      if (p.from === 'inferred') {
        out.push(`> [!note] ${h.inferred_callout}`)
        out.push(`> ※ ${p.text}`)
        out.push('')
      } else {
        out.push(`- ${autoLinkTerms(p.text, terms)} ${deepLink(ctx.sourceUrl, p.ts)}`)
      }
    }
    for (const e of s.examples) {
      if (e.from === 'inferred') {
        out.push(`> [!note] ${h.inferred_callout}`)
        out.push(`> ※ ${e.text}`)
        out.push('')
      } else {
        out.push(`- ${h.examples_inline_prefix}: ${escapeText(e.text)} ${deepLink(ctx.sourceUrl, e.ts)}`)
      }
    }
    out.push('')
  }

  if (s.related_terms && s.related_terms.length > 0) {
    const links = s.related_terms.map(t => `[[${sanitiseWikilink(t)}]]`).join(' · ')
    out.push(`**${h.related_inline}**: ${links}`)
    out.push('')
  }

  // procedure_steps
  if (s.procedure_steps && s.procedure_steps.length > 0) {
    out.push(`#### ${h.steps_label}`)
    out.push('')
    s.procedure_steps.forEach((st, i) => {
      const order = st.order ?? i + 1
      if (st.from === 'inferred') {
        out.push(`> [!note] ${h.inferred_callout}`)
        out.push(`> ${order}. ※ ${st.text}`)
        out.push('')
      } else {
        out.push(`${order}. ${st.text} [▶ ${formatMMSS(st.ts)}](${ctx.sourceUrl}${ctx.sourceUrl.includes('?') ? '&' : '?'}t=${Math.floor(st.ts)}s&__sh_seek=${Math.floor(st.ts)})`)
      }
    })
    out.push('')
  }

  // formula
  if (s.formula && s.formula.length > 0) {
    out.push(`#### ${h.formula_label}`)
    out.push('')
    for (const f of s.formula) {
      if (f.from === 'inferred') {
        out.push(`> [!note] ${h.inferred_callout} — ※ ${f.label ?? ''}`)
        out.push('> ```math')
        out.push(`> ${f.expression}`)
        out.push('> ```')
        out.push('')
      } else {
        if (f.label) out.push(`**${f.label}**`)
        out.push('```math')
        out.push(f.expression)
        out.push('```')
        out.push('')
      }
    }
  }

  // argument_chain
  if (s.argument_chain && s.argument_chain.length > 0) {
    out.push(`#### ${h.argument_label}`)
    out.push('')
    for (const l of s.argument_chain) {
      if (l.from === 'inferred') {
        out.push(`> [!note] ${h.inferred_callout}`)
        out.push(`> → ※ ${l.text}`)
        out.push('')
      } else {
        out.push(`- → ${l.text} [▶ ${formatMMSS(l.ts)}](${ctx.sourceUrl}${ctx.sourceUrl.includes('?') ? '&' : '?'}t=${Math.floor(l.ts)}s&__sh_seek=${Math.floor(l.ts)})`)
      }
    }
    out.push('')
  }

  // timeline — 2nd column header: no `event_label` in HeadingSet, so
  // hardcode per-locale: ja=イベント, en=Event, ko=이벤트, zh=事件
  if (s.timeline && s.timeline.length > 0) {
    const eventLabel = { ja: 'イベント', en: 'Event', ko: '이벤트', zh: '事件' }[ctx.lang ?? 'ja']
    out.push(`#### ${h.timeline_label}`)
    out.push('')
    out.push(`| ${h.timeline_label} | ${eventLabel} |`)
    out.push('|---|---|')
    for (const ev of s.timeline) {
      const marker = ev.from === 'inferred' ? '※ ' : ''
      out.push(`| ${marker}${ev.when} | ${ev.event} |`)
    }
    out.push('')
  }

  // No `---` between sections — the H2 with its CSS underline is
  // already a strong visual divider, and the explicit horizontal
  // rules added another ~1em of whitespace per section that wasn't
  // pulling its weight. (Removed 2026-04-30 along with other
  // density-improvement compressions.)
  return out
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

// Placeholder values curator may emit when it can't extract course /
// lecturer. Scrubbing also happens in curator.ts before persistence,
// but this is a defensive second pass for outlines already in the DB
// that pre-date that scrub. Keep both in sync.
const PLACEHOLDER_VALUES = new Set([
  '不明', 'unknown', 'n/a', 'na', '-', '—', 'なし', '未定', 'unspecified',
])
function isMeaningful(s: string | undefined | null): s is string {
  if (!s) return false
  const trimmed = s.trim()
  if (!trimmed) return false
  return !PLACEHOLDER_VALUES.has(trimmed.toLowerCase())
}

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
  // Course / lecturer are emitted as frontmatter wikilinks ONLY when we
  // have a real value. A `[[不明]]` placeholder would create a fake hub
  // node aggregating every lecture where curator couldn't extract these
  // fields — actively pollutes the knowledge graph. Better to omit the
  // field entirely so unknown lectures stay unconnected to any hub.
  if (isMeaningful(o.course))   lines.push(`course: "[[${sanitiseWikilink(o.course!)}]]"`)
  if (isMeaningful(o.lecturer)) lines.push(`lecturer: "[[${sanitiseWikilink(o.lecturer!)}]]"`)
  lines.push(`date: ${date}`)
  if (ctx.durationSec) lines.push(`duration: "${formatHHMMSS(ctx.durationSec)}"`)
  lines.push(`source: "${ctx.sourceUrl}"`)
  lines.push(`session_id: ${ctx.sessionId}`)
  // Structured key_terms array. Body wikilinks already make terms
  // queryable via `file.outlinks`, but `outlinks` mixes course /
  // lecturer / related lectures together. Exposing the term set as
  // its own frontmatter property lets Dataview pick out lectures by
  // primary concept precisely:
  //   WHERE contains(key_terms, [[持続可能性]])
  // returns lectures where the concept is a CORE term, not just a
  // passing mention.
  const keyTerms = collectTerms(o)
  if (keyTerms.length > 0) {
    lines.push(`key_terms:`)
    for (const t of keyTerms) lines.push(`  - "[[${sanitiseWikilink(t)}]]"`)
  }
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
  // Skip from:'inferred' terms — they are AI-supplemented (spec §1.4 "AI 보충
  // 을 학생이 한눈에 식별"). Surfacing them in YAML frontmatter `key_terms:`
  // and inline wikilinks would make them indistinguishable from transcript-
  // derived terms in Obsidian's Properties / Graph / Dataview views.
  const set = new Set<string>()
  for (const s of o.sections)
    for (const kt of s.key_terms)
      if (kt.term && kt.from !== 'inferred') set.add(kt.term)
  return Array.from(set)
}

function collectCheckQuestions(o: Outline): string[] {
  return o.sections.map(s => s.check_question).filter((q): q is string => !!q && !!q.trim())
}

// Bucket slides by section ts range. Section i with ts T_i owns slides
// satisfying T_i <= slide.ts < T_{i+1}; the last section absorbs all
// remaining slides. Mirrors bucketSlides in the React OutlineView so
// the markdown export's per-section image placement matches what the
// user saw in the modal.
function bucketSlidesBySection<S extends { ts: number }>(
  sections: S[],
  slides: { ts: number; key: string; url: string }[],
): { ts: number; key: string; url: string }[][] {
  if (sections.length === 0) return []
  const buckets: { ts: number; key: string; url: string }[][] = sections.map(() => [])
  for (const slide of slides) {
    let idx = 0
    for (let i = 0; i < sections.length; i++) {
      if (slide.ts >= sections[i].ts) idx = i
      else break
    }
    buckets[idx].push(slide)
  }
  return buckets
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
  // Build a deep link with TWO timestamp signals so the link auto-seeks
  // on as many platforms as possible:
  //
  //   - `t=NNs`         : YouTube / Vimeo / HTML5 <video> standard. Most
  //                       public video platforms honour this.
  //
  //   - `__sh_seek=NN`  : Our Study-Helper marker. K-LMS / Canvas Studio /
  //                       Kaltura / Brightcove etc. all ignore standard
  //                       URL timestamp params (verified empirically with
  //                       K-LMS on 2026-04-30 — none of t / start /
  //                       startTime / st / time / #t worked). When the
  //                       user has our extension installed, the content
  //                       script reads this param on page load and sets
  //                       `<video>.currentTime` directly via DOM, which
  //                       bypasses whatever the host's player does or
  //                       doesn't support. Friends sharing the file
  //                       without the extension fall back to "video
  //                       opens, scrub manually" — same as before.
  const sep = sourceUrl.includes('?') ? '&' : '?'
  const sec = Math.max(0, Math.floor(ts))
  const linked = `${sourceUrl}${sep}t=${sec}s&__sh_seek=${sec}`
  return `[▶ ${formatMMSS(ts)}](${linked})`
}

/** Auto-replaces occurrences of any term in `terms` with [[term]] in `text`,
 *  longest-first so "持続可能性" doesn't get broken into [[持続]]可能性 by a
 *  shorter match. Idempotent — won't double-link an already wikilinked term. */
function autoLinkTerms(text: string, terms: string[]): string {
  if (!text || terms.length === 0) return escapeText(text)
  const sorted = [...new Set(terms)].sort((a, b) => b.length - a.length)
  let result = text
  for (const t of sorted) {
    if (!t || t.length < 2) continue
    const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // Skip terms already wrapped in [[…]] to avoid double-bracket
    const re = new RegExp(`(?<!\\[\\[)${escaped}(?!\\]\\])`, 'g')
    result = result.replace(re, `[[${sanitiseWikilink(t)}]]`)
  }
  return result
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
