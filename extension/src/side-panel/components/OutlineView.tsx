import { useEffect, useMemo, useRef, useState } from 'react'
import type { Outline, OutlineSection } from '../api-client'
import type { SlideItem } from '../../shared/types'
import { useT, interpolate, getLang } from '../../shared/i18n'

// Renders the curated lecture outline produced by the backend's curator
// pass. The outline is REPLACED on every curator run (every ~30 s of
// lecture audio), so the UI naturally evolves: early in the lecture there
// might be a single section with a brief summary, and as more audio is
// transcribed the curator adds key terms, examples, and reorganises
// sections into the right hierarchy.
//
// Visual hierarchy:
//   Lecture title (h2)
//   └─ Section heading (h3) + start timestamp
//      ├─ Section summary (1-2 line italic prose)
//      ├─ Key terms (tinted card with definition)
//      ├─ Examples (bullet, neutral)
//      └─ Points (bullet; ★ prefix when important)
//
// Empty state matches what the user has always seen: 「処理中... 講義を再生してください。」
// — preserved because the curator only fires after the first transcript
// arrives, so the modal still feels alive while the first chunk uploads.

function fmtTs(secs: number): string {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = Math.floor(secs % 60)
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

interface Props {
  outline: Outline | null
  /** All slides captured for this session, sorted by ts (the WS pushes
   *  them in order and App.tsx appends in order). Used to attach a
   *  thumbnail strip to the section whose ts range covers each slide. */
  slides?: SlideItem[]
  onJump?: (ts: number) => void
  /** User clicked the hover-X on a thumbnail. App.tsx wires this to
   *  useSession.removeSlide which strips local state + POSTs the
   *  backend. Optional — when omitted, thumbnails render without the
   *  delete affordance (the strip stays read-only). */
  onSlideRemove?: (key: string) => void
  /** Optional override for the lecture title. When the user edits the
   *  filename via EditableFilename, the modal should reflect that
   *  edit immediately so the H1 here matches what the export will
   *  produce. Falls back to outline.title when omitted. */
  displayTitle?: string
  /** Last-updated timestamp (epoch ms) for the displayed outline.
   *  Single source of truth — App.tsx sets it from sessions.updated_at
   *  on hydrate (when an outline already exists) and to Date.now() on
   *  every fresh curate completion (HTTP response, WS broadcast, or
   *  postMessage forward). null means "no outline yet" — indicator
   *  is hidden. The component used to derive its own refreshedAt
   *  with a "first content arrival" branch keyed on this prop, but
   *  that mishandled the case where a session row had a recent
   *  updated_at (from audio chunks) and a NULL outline column — the
   *  first curate's outline arrival would inherit the audio-chunk
   *  timestamp instead of stamping NOW. Lifting authority to App.tsx
   *  fixed it cleanly. */
  outlineUpdatedAt?: number | null
}

// Bucket slides by section. Each section i with ts T_i owns slides
// satisfying T_i <= slide.ts < T_{i+1}; the last section absorbs all
// remaining slides. We compute this once per render and pass the per-
// section slice into SectionBlock.
function bucketSlides(sections: OutlineSection[], slides: SlideItem[]): SlideItem[][] {
  if (sections.length === 0) return []
  const buckets: SlideItem[][] = sections.map(() => [])
  // Boundaries: [s0.ts, s1.ts), [s1.ts, s2.ts), … last is [sN-1.ts, ∞)
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

export function OutlineView({ outline, slides = [], onJump, onSlideRemove, displayTitle, outlineUpdatedAt }: Props) {
  const T = useT()
  // Flash a brief visual cue whenever the outline content actually
  // changes — the curator rewrites the whole document each run, and
  // without this signal the user can't tell that earlier sections
  // were just rewritten. The JSON.stringify diff filters out no-op
  // redeliveries (WS reconnect can replay the same outline; that
  // shouldn't flash). The first non-null outline arrival skips the
  // flash so re-opening a modal on a previously-saved note doesn't
  // pretend something just changed. Timestamp display is decoupled
  // from this — the indicator pulls from the outlineUpdatedAt prop
  // directly, so user-triggered regenerates with byte-identical JSON
  // (gpt-4o-mini deterministic on unchanged inputs) still update the
  // visible "X分前" reading even though no flash fires.
  const [flashing, setFlashing] = useState(false)
  const lastSerialisedRef = useRef<string>('')
  useEffect(() => {
    if (!outline) return
    const serialised = JSON.stringify(outline)
    if (serialised === lastSerialisedRef.current) return
    const isFirst = lastSerialisedRef.current === ''
    lastSerialisedRef.current = serialised
    if (isFirst) return  // hydrating into the modal — content didn't "just change"
    setFlashing(true)
    const t = window.setTimeout(() => setFlashing(false), 800)
    return () => window.clearTimeout(t)
  }, [outline])

  if (!outline || outline.sections.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto px-3 py-4 lisna-scroll">
        <p className="text-sm text-ink-500">{T.outline.emptyHint}</p>
      </div>
    )
  }

  // Compact mode (DESIGN.md §7 C2) — toggle that hides everything
  // except TLDR / Take / important points. Local state only; the
  // user's choice resets per session because the appropriate density
  // depends on what they're doing right now (skimming vs deep-reading)
  // and a sticky preference would feel wrong on a different lecture.
  const [compact, setCompact] = useState(false)

  // Section refs so the Quiz roll-up's "→ NN" buttons + the Section
  // Rail's dot/label clicks can scroll to the source section (the
  // scroll container is an inner overflow, not the window — native
  // #anchor jumps would scroll the page around the iframe instead).
  const sectionRefs = useRef<(HTMLElement | null)[]>([])
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const outerRef = useRef<HTMLDivElement | null>(null)
  // Tracks the last rail-clicked section. Used as a fallback when
  // scrolling isn't actually possible (short outline that fits in the
  // viewport): scrollTo() is a no-op there, so the scroll-derived
  // active-index can never reflect the user's click. Without this
  // override, the rail's bottom-snap rule would pin active to the
  // last section forever and earlier dots would look "broken".
  const [lastClickedIdx, setLastClickedIdx] = useState<number | null>(null)
  const scrollToSection = (i: number) => {
    setLastClickedIdx(i)
    const target = sectionRefs.current[i]
    if (!target) return
    // scrollIntoView walks UP from the target to find the nearest scrollable
    // ancestor and scrolls IT. Previously we used container.scrollTo() with
    // target.offsetTop, which broke in two cases:
    //   (a) target.offsetParent ≠ scrollContainerRef.current — nested layout
    //       (e.g. mini-TOC labels wrapping) makes offsetTop relative to an
    //       intermediate offsetParent, so the math was off.
    //   (b) the scroll container's content fit in its visible height (short
    //       outline, narrow modal) — scrollTo was a silent no-op.
    // scrollIntoView is immune to both; it doesn't care which ancestor
    // actually overflows.
    target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // Modal-width awareness for the Section Rail wide mode (DESIGN.md
  // §7 A1). Watches OUR own outer container — works in both the
  // in-page modal (resizable iframe) and Chrome's side panel
  // (user-resizable column). Above 460px we have room to render the
  // rail as a labeled mini-TOC instead of the compact dot column.
  const [outerWidth, setOuterWidth] = useState(0)
  useEffect(() => {
    if (!outerRef.current) return
    const el = outerRef.current
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setOuterWidth(e.contentRect.width)
    })
    ro.observe(el)
    setOuterWidth(el.getBoundingClientRect().width)
    return () => ro.disconnect()
  }, [])
  // Wide mode threshold lowered from 460 to 420 so realistically-sized
  // modals (Chrome side panel default ~360, in-page modal default
  // ~min(viewport*0.32, 480)) can actually reach the labeled mini-TOC
  // mode. Above 420 the rail expands into a 132 px text column —
  // unless the user has manually clicked to keep it as dots.
  const wideAvailable = outerWidth >= 420
  // User-controlled rail compaction. Persisted to chrome.storage so
  // the user's choice survives modal close/reopen. Default: auto
  // (= follow width). Once the user clicks to compact, we show the
  // dot column even when there's room for the labeled mini-TOC.
  const RAIL_COLLAPSED_KEY = 'sh.railCollapsed'
  const [railUserCollapsed, setRailUserCollapsed] = useState(false)
  useEffect(() => {
    void chrome.storage.local.get(RAIL_COLLAPSED_KEY).then((r) => {
      if (r[RAIL_COLLAPSED_KEY] === true) setRailUserCollapsed(true)
    })
  }, [])
  const toggleRailCollapsed = () => {
    setRailUserCollapsed((c) => {
      const next = !c
      void chrome.storage.local.set({ [RAIL_COLLAPSED_KEY]: next })
      return next
    })
  }
  const isWide = wideAvailable && !railUserCollapsed
  // Rail visibility threshold lowered from 3 → 2 so even short
  // lectures get an orientation aid. With 1 section the rail has no
  // navigation value so it stays hidden.
  const showRail = outline.sections.length >= 2

  // Active section tracking — last section whose offsetTop crossed
  // a fixed line above the viewport top, with bottom-of-scroll
  // snap so the final section's dot still lights up at scroll end.
  const [scrollDerivedIdx, setScrollDerivedIdx] = useState(0)
  // True when the outline's content height exceeds the scroll
  // container — i.e., scrolling can actually move things. Short
  // 2-section outlines on a tall panel may have canScroll === false,
  // in which case we fall back to lastClickedIdx for the active
  // index instead of letting the bottom-snap rule pin to the last
  // section permanently.
  const [canScroll, setCanScroll] = useState(false)
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const update = () => {
      const can = el.scrollHeight - el.clientHeight > 4
      setCanScroll(can)
      const trigger = el.scrollTop + 80
      let idx = 0
      for (let i = 0; i < outline.sections.length; i++) {
        const s = sectionRefs.current[i]
        if (s && s.offsetTop <= trigger) idx = i
      }
      // Only apply the snap-to-last-on-bottom rule when scrolling is
      // actually possible. Otherwise scrollTop=0 and clientHeight ===
      // scrollHeight means atBottom is always true, which would lock
      // active to the last section even on first paint.
      const atBottom = can && el.scrollTop + el.clientHeight >= el.scrollHeight - 8
      if (atBottom && outline.sections.length > 0) idx = outline.sections.length - 1
      setScrollDerivedIdx(idx)
    }
    el.addEventListener('scroll', update, { passive: true })
    // Recompute on container/content resize too — content streams in
    // during curate, so clientHeight/scrollHeight evolve over time.
    const ro = new ResizeObserver(update)
    ro.observe(el)
    update()
    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [outline.sections.length])
  // Effective rail/section active index. When the outline fits without
  // scrolling, prefer the user's last explicit click; otherwise the
  // scroll position is the source of truth.
  const activeIdx = !canScroll && lastClickedIdx !== null ? lastClickedIdx : scrollDerivedIdx

  return (
    // overflow-hidden on the outer + min-h-0 prevents the rail/scroll
    // pair from pushing the App's flex-col parent past its min-h-
    // screen — without it, the App body itself scrolls when notes
    // exceed viewport height and the rail (a flex sibling, not a
    // fixed surface) scrolls away with it. With overflow-hidden the
    // outer container is height-bounded, the inner scroll handles
    // overflow on its own, and the rail stays put because nothing
    // is moving its flex slot.
    <div ref={outerRef} className={`flex-1 flex min-h-0 overflow-hidden transition-colors duration-700 ${flashing ? 'bg-terra-tint' : 'bg-transparent'}`}>
      {showRail && (
        <SectionRail
          sections={outline.sections}
          activeIdx={activeIdx}
          wide={isWide}
          canExpand={wideAvailable && railUserCollapsed}
          onJump={scrollToSection}
          onToggleWide={toggleRailCollapsed}
        />
      )}
      {/* relative is critical: section.offsetTop (used by both the
          active-tracking scroll listener and the rail/quiz click
          handlers) returns the offset to the nearest positioned
          ancestor. Without `relative` here, offsetTop measures
          against some far-up ancestor (or the viewport) and the
          jump math + active-section detection both go wrong. */}
      <div ref={scrollContainerRef} className="lisna-scroll relative flex-1 overflow-y-auto px-3 py-3 space-y-4 min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        {(displayTitle?.trim() || outline.title) && (
          <h2 className="text-base font-bold text-ink-900 leading-snug tracking-headline-tight">
            {displayTitle?.trim() || outline.title}
          </h2>
        )}
        {outlineUpdatedAt != null && (
          <RefreshIndicator at={outlineUpdatedAt} />
        )}
      </div>
      {/* Meta-row: section/important counts on the left, Compact
          toggle on the right. Replaces the previous "Compact button
          stranded next to the refresh indicator" layout. Mockup
          notes-v2.html shows this row immediately under the title
          + TLDR. */}
      {outline.sections.length > 0 && (
        <div className="flex items-center gap-3 text-[10px] font-mono tabular-nums text-ink-500 tracking-wide -mt-1">
          <span><span className="text-ink-900 font-medium">{outline.sections.length}</span> {outline.sections.length === 1 ? T.outline.metaSectionsOne : T.outline.metaSectionsMany}</span>
          {(() => {
            const importantCount = outline.sections.reduce(
              (sum, s) => sum + s.points.filter(p => p.important).length,
              0,
            )
            return importantCount > 0 ? (
              <span><span className="text-ink-900 font-medium">{importantCount}</span> {T.outline.metaHighlights}</span>
            ) : null
          })()}
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => setCompact(c => !c)}
            className={
              'inline-flex items-center gap-1 text-[10px] font-medium font-mono uppercase tracking-eyebrow px-2 py-[3px] rounded transition-colors ' +
              (compact
                ? 'bg-ink-900 text-paper-100 border border-ink-900'
                : 'bg-paper-200 text-ink-700 hover:bg-paper-300 border border-paper-edge')
            }
            title={T.outline.compactToggleTitle}
            aria-pressed={compact}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
              <line x1="4" y1="6" x2="20" y2="6" />
              <line x1="4" y1="12" x2="14" y2="12" />
              <line x1="4" y1="18" x2="10" y2="18" />
            </svg>
            {T.outline.compactToggle}
          </button>
        </div>
      )}
      <SectionList
        outline={outline}
        slides={slides}
        onJump={onJump}
        onSlideRemove={onSlideRemove}
        compact={compact}
        sectionRefs={sectionRefs}
      />
      <QuizRollup
        sections={outline.sections}
        onJumpToSection={scrollToSection}
      />
      {/* SectionList memoizes the per-section slide bucketing so we
          don't re-traverse both arrays on every parent render. */}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────
// Section Rail (DESIGN.md §7 A1)
//
// Sticky vertical mini-TOC on the left edge of the OutlineView. Two
// modes triggered by the outer container's measured width:
//
//   Narrow (<460px): 18px-wide column of dots. Active dot fills with
//   ink-900 + scales 1.5×; click jumps to that section. Visual sibling
//   of the iOS Music app's "current track" rail or Linear's section
//   navigation rail in narrow mode.
//
//   Wide (≥460px): 132px-wide column with 2-digit section number
//   (mono) + heading text per row. Active row gets a paper-100
//   background + terra leftbar + ink-900 bold heading. Hover lifts
//   to paper-100 with the dot turning ink-700.
//
// The rail is INSIDE the OutlineView's outer flex container so it
// sits next to the scroll area, NOT inside it. That way the rail
// stays in place while the user scrolls — exactly the "always-on
// orientation aid" the long-lecture annotations called for.
// ────────────────────────────────────────────────────────────────────
function SectionRail({
  sections,
  activeIdx,
  wide,
  canExpand,
  onJump,
  onToggleWide,
}: {
  sections: Outline['sections']
  activeIdx: number
  wide: boolean
  /** When true, the user has manually compacted the rail even
   *  though the modal is wide enough for the mini-TOC. Show the
   *  expand-back affordance in narrow mode so they can flip back. */
  canExpand: boolean
  onJump: (idx: number) => void
  onToggleWide: () => void
}) {
  // Chevron button at the top of the rail. Tree-disclosure pattern
  // (DESIGN.md §3.5): in wide mode it points LEFT (▶ rotated -90°)
  // → click to compact to dot column. In narrow-by-choice mode it
  // points RIGHT (▶) → click to bring the labels back. Hidden when
  // narrow-because-no-room (canExpand=false in narrow mode).
  const showToggle = wide || canExpand
  const ToggleButton = showToggle ? (
    <button
      type="button"
      onClick={onToggleWide}
      aria-label={wide ? 'Compact section rail' : 'Expand section rail'}
      title={wide ? 'Compact (dots only)' : 'Expand to labels'}
      className={
        'flex items-center justify-center text-ink-300 hover:text-ink-700 hover:bg-paper-100 rounded transition-colors ' +
        (wide ? 'w-full mb-1 py-1' : 'mx-auto my-1 w-4 h-4')
      }
    >
      <svg
        width="11" height="11" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
        aria-hidden
        // Wide → arrow points LEFT (collapse). Narrow-by-choice →
        // arrow points RIGHT (expand). Single SVG chevron rotated.
        style={{ transform: wide ? 'rotate(0deg)' : 'rotate(180deg)' }}
      >
        <polyline points="15 6 9 12 15 18" />
      </svg>
    </button>
  ) : null

  if (wide) {
    return (
      <nav
        aria-label="Sections"
        className="shrink-0 w-[132px] py-2 pl-1 pr-1 overflow-y-auto lisna-scroll border-r border-paper-edge bg-paper-200"
      >
        {ToggleButton}
        <ul className="m-0 p-0 list-none space-y-px">
          {sections.map((s, i) => {
            const active = i === activeIdx
            return (
              <li key={`rail-${i}`}>
                <button
                  type="button"
                  onClick={() => onJump(i)}
                  aria-current={active ? 'true' : undefined}
                  className={
                    'group w-full flex items-center gap-2 px-2 py-1.5 text-left rounded transition-colors ' +
                    (active
                      ? 'bg-paper-100 text-ink-900 font-semibold shadow-[inset_2px_0_0_var(--terra)]'
                      : 'text-ink-500 hover:bg-paper-100 hover:text-ink-900')
                  }
                  title={s.heading}
                >
                  <span
                    className={'shrink-0 w-1.5 h-1.5 rounded-full ' + (active ? 'bg-terra' : 'bg-ink-200 group-hover:bg-ink-500')}
                  />
                  <span className={'shrink-0 text-[10px] font-mono tabular-nums tracking-wide ' + (active ? 'text-terra' : 'text-ink-300')}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="flex-1 min-w-0 text-[11.5px] leading-snug whitespace-nowrap overflow-hidden text-ellipsis">
                    {s.heading}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </nav>
    )
  }
  // Narrow — dot column. Show the expand toggle at top only when the
  // user could theoretically expand (modal wide enough but they chose
  // to compact). Hide it when narrow-by-necessity (modal too small).
  return (
    <nav
      aria-label="Sections"
      className="shrink-0 w-[20px] py-2 flex flex-col items-center border-r border-paper-edge bg-paper-200"
    >
      {ToggleButton}
      {sections.map((_, i) => {
        const active = i === activeIdx
        return (
          <button
            key={`rail-dot-${i}`}
            type="button"
            onClick={() => onJump(i)}
            aria-label={`Section ${i + 1}`}
            aria-current={active ? 'true' : undefined}
            className="my-[5px] flex items-center justify-center w-3 h-3 rounded-full focus:outline-none"
          >
            <span
              className={
                'block rounded-full transition-all ' +
                (active
                  ? 'bg-ink-900 w-[9px] h-[9px]'
                  : 'bg-ink-200 hover:bg-ink-500 w-[6px] h-[6px]')
              }
            />
          </button>
        )
      })}
    </nav>
  )
}

// Memoized list-of-sections wrapper. Recomputes the per-section slide
// bucket only when `outline` or `slides` actually change references —
// avoids re-iterating both arrays on every keystroke / unrelated state
// change in the parent.
function SectionList({
  outline,
  slides,
  onJump,
  onSlideRemove,
  compact,
  sectionRefs,
}: {
  outline: Outline
  slides: SlideItem[]
  onJump?: (ts: number) => void
  onSlideRemove?: (key: string) => void
  compact: boolean
  sectionRefs: React.MutableRefObject<(HTMLElement | null)[]>
}) {
  const buckets = useMemo(
    () => bucketSlides(outline.sections, slides),
    [outline.sections, slides],
  )
  return (
    <>
      {outline.sections.map((section, i) => (
        <SectionBlock
          key={`${section.heading}-${i}`}
          section={section}
          slides={buckets[i]}
          onJump={onJump}
          onSlideRemove={onSlideRemove}
          compact={compact}
          sectionRef={(el) => { sectionRefs.current[i] = el }}
          index={i}
        />
      ))}
    </>
  )
}

// Quiz roll-up — DESIGN.md §7 C5. Aggregates every section's
// check_question into a single end-of-notes review block. Each item
// links back to its source section via scrollIntoView so a quick
// review is one click away. Hidden entirely when no section has a
// check_question (avoids the empty "Review Questions" header on
// short lectures).
function QuizRollup({
  sections,
  onJumpToSection,
}: {
  sections: Outline['sections']
  onJumpToSection: (idx: number) => void
}) {
  const T = useT()
  const items = sections
    .map((s, i) => ({ section: s, index: i }))
    .filter(({ section }) => section.check_question?.trim())
  if (items.length === 0) return null
  return (
    <section className="rounded-[10px] border border-paper-edge bg-paper-200 px-4 py-3">
      <div className="flex items-baseline gap-2 mb-2.5">
        <span className="text-[10px] font-mono uppercase tracking-eyebrow text-ink-500 font-semibold">
          {T.outline.quizLabel}
        </span>
        <span className="text-[10px] font-mono text-ink-300">
          {items.length} {items.length === 1 ? T.outline.quizCountSingular : T.outline.quizCountPlural}
        </span>
      </div>
      <ol className="m-0 p-0 list-none [counter-reset:q]">
        {items.map(({ section, index }) => (
          <li
            key={`q-${index}`}
            className="flex gap-2.5 items-start py-2 border-t border-dashed border-paper-edge first:border-t-0 first:pt-0 text-xs text-ink-700 leading-relaxed [counter-increment:q]"
          >
            <span
              className="flex-shrink-0 min-w-[20px] pt-px font-mono text-[10px] font-semibold text-ink-300 tracking-wide before:content-['Q'_counter(q)]"
              aria-hidden="true"
            />
            <span className="flex-1">{section.check_question}</span>
            <button
              type="button"
              onClick={() => onJumpToSection(index)}
              className="flex-shrink-0 inline-flex items-center font-mono text-[10px] text-ink-500 hover:text-paper-100 hover:bg-ink-900 rounded px-1.5 py-0.5 transition-colors"
              title={T.outline.quizJumpTitle}
            >
              → {String(index + 1).padStart(2, '0')}
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}

// Maps our internal language codes to BCP 47 locales for Intl.DateTimeFormat.
// Without this, `new Intl.DateTimeFormat('ja')` works but `'ko'` / `'zh'`
// pick the platform default which can render the wrong calendar / month
// abbreviation. Pinning to the country form gives the user the exact
// glyphs they see in the rest of the modal.
const BCP47: Record<'ja' | 'en' | 'ko' | 'zh', string> = {
  ja: 'ja-JP',
  en: 'en-US',
  ko: 'ko-KR',
  zh: 'zh-CN',
}

// Locale-aware absolute time. Drops the year when the timestamp is in
// the same calendar year as "now" — for a returning-user reading a
// note from last week, "10月3日 14:32" is plenty; "2026年" prefix is
// noise. Falls back to the full form across years.
function formatAbsolute(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const locale = BCP47[getLang()]
  const sameYear = d.getFullYear() === now.getFullYear()
  return new Intl.DateTimeFormat(locale, {
    year: sameYear ? undefined : 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}

// Renders the outline's last-update time. Two display modes:
//   - within 24 h: relative ("X分前") with the existing tick loop so the
//     label stays accurate as time elapses.
//   - 24 h or older: absolute date+time. Once a note is "yesterday or
//     before" the relative form ("48時間前") is harder to map to a real
//     calendar moment than just showing the date, and we can stop the
//     tick interval entirely (saves CPU/battery on long-idle modals).
//
// Re-evaluated when `at` changes — fresh curate / WS update flips the
// indicator back to the rolling-counter mode if the new timestamp is
// recent.
function RefreshIndicator({ at }: { at: number }) {
  const T = useT()
  const ABSOLUTE_AFTER_SECS = 86_400  // 24 h
  const [, setTick] = useState(0)
  useEffect(() => {
    const initialAgo = Math.floor((Date.now() - at) / 1000)
    if (initialAgo >= ABSOLUTE_AFTER_SECS) return
    const id = window.setInterval(() => {
      const ago = Math.floor((Date.now() - at) / 1000)
      setTick(t => t + 1)
      if (ago >= ABSOLUTE_AFTER_SECS) window.clearInterval(id)
    }, 30_000)
    return () => window.clearInterval(id)
  }, [at])
  const ago = Math.floor((Date.now() - at) / 1000)
  let label: string
  if (ago >= ABSOLUTE_AFTER_SECS) label = formatAbsolute(at)
  else if (ago < 5) label = T.outline.refresh_just
  else if (ago < 60) label = interpolate(T.outline.refresh_secAgo, { n: ago })
  else if (ago < 3600) label = interpolate(T.outline.refresh_minAgo, { n: Math.floor(ago / 60) })
  else label = interpolate(T.outline.refresh_hrAgo, { n: Math.floor(ago / 3600) })
  return (
    <span
      className="text-[10px] text-ink-300 font-mono shrink-0 whitespace-nowrap"
      title={T.outline.refreshTooltip}
    >
      ✎ {label}
    </span>
  )
}

function SectionBlock({
  section,
  slides = [],
  onJump,
  onSlideRemove,
  compact = false,
  sectionRef,
  index,
}: {
  section: OutlineSection
  slides?: SlideItem[]
  onJump?: (ts: number) => void
  onSlideRemove?: (key: string) => void
  /** When true (Compact toggle, DESIGN.md §7 C2), hides everything
   *  except heading + takeaway + important points. Lets the user
   *  switch to an exam-cram view without losing the underlying
   *  data. */
  compact?: boolean
  /** Forwarded so the parent can scroll to this section from the
   *  Quiz roll-up's "→ NN" button. */
  sectionRef?: (el: HTMLElement | null) => void
  /** Position in the section list. Kept for future Section Rail
   *  (DESIGN.md §7 A1) — A1 will need it to map dot index to
   *  section. Currently unused but threaded through so adding the
   *  rail later is just CSS / a sibling component. */
  index?: number
}) {
  const T = useT()
  // Section collapse state (DESIGN.md §7 D2 — chevron in heading
  // row, default expanded). Local state per-section: a collapse
  // pattern that's about to be undone after the user reads the
  // heading shouldn't survive the modal closing. ▼ when expanded /
  // ▶ when collapsed (tree disclosure pattern from DESIGN.md §3.5).
  const [collapsed, setCollapsed] = useState(false)
  // Phase 6 optional fields (takeaway / related_terms / check_question)
  // are now part of the typed OutlineSection — no more `as` cast. UI
  // renders them as plain text; the markdown export pipeline handles
  // their wikilink/callout formatting separately.
  return (
    <section
      className="space-y-2"
      ref={sectionRef}
      data-section-index={index}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink-900 leading-snug flex-1">
          {section.heading}
        </h3>
        <TsButton ts={section.ts} onJump={onJump} />
        <button
          type="button"
          onClick={() => setCollapsed(c => !c)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? T.outline.expandSectionAria : T.outline.collapseSectionAria}
          title={collapsed ? T.outline.expandSectionTitle : T.outline.collapseSectionTitle}
          className="shrink-0 w-5 h-5 flex items-center justify-center text-ink-300 hover:text-ink-700 hover:bg-paper-200 rounded transition-colors"
        >
          <svg
            width="12" height="12" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
            aria-hidden="true"
            style={{ transition: 'transform 220ms ease', transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>

      {collapsed ? null : <>

      {slides.length > 0 && !compact && <SlideStrip slides={slides} onJump={onJump} onSlideRemove={onSlideRemove} />}

      {/* Takeaway = warm emphasis card per DESIGN.md §2.1.1
          (terra-tint surface + terra-soft border + terra leftbar).
          Always shown; this is the section's most important content. */}
      {section.takeaway && (
        <div className="bg-terra-tint border border-terra-soft border-l-[3px] border-l-terra px-2.5 py-1.5 rounded-md-design">
          <p className="text-xs text-ink-900 leading-snug font-medium">
            <span className="text-[10px] font-mono uppercase tracking-eyebrow text-terra-700 font-semibold mr-1.5">{T.outline.summary_label}</span>
            {section.takeaway}
          </p>
        </div>
      )}

      {!compact && section.summary && !section.takeaway && (
        <p className="text-xs text-ink-700 leading-relaxed">
          {section.summary}
        </p>
      )}

      {/* Key terms — neutral paper card with subtle dashed dividers
          between entries. Per DESIGN.md §4.2 the term name carries
          the visual weight, definition stays readable but quieter.
          Hidden in compact mode (DESIGN.md §7 C2). */}
      {!compact && section.key_terms.length > 0 && (
        <ul className="space-y-1.5">
          {section.key_terms.map((kt, i) => (
            <li
              key={`${kt.term}-${i}`}
              className="bg-paper-200 border border-paper-edge rounded-md-design px-2 py-1.5 text-xs"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold text-ink-900">{kt.term}</span>
                <TsButton ts={kt.ts} onJump={onJump} />
              </div>
              <div className="text-ink-700 mt-0.5 leading-relaxed">
                {kt.definition}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Points — important uses solid terra dot + .lisna-hl
          highlighter (solid block, box-decoration-break clone) on
          the body text per DESIGN.md §5.4. Regular points use a
          small ink-200 dot. */}
      {/* Points — Compact mode keeps important points (highlighter),
          drops regular ones. Important point = essence; regular
          point = evidence. The exam-cram view wants essence only. */}
      {section.points.length > 0 && (
        <ul className="space-y-1">
          {section.points.filter(p => compact ? p.important : true).map((p, i) => (
            <li
              key={`${p.text.slice(0, 24)}-${i}`}
              className="text-xs leading-relaxed flex gap-2 items-baseline"
            >
              <span
                aria-hidden
                className={p.important ? 'shrink-0 self-center' : 'text-ink-200 shrink-0'}
                style={p.important ? {
                  width: '6px',
                  height: '6px',
                  borderRadius: '9999px',
                  background: 'var(--terra)',
                  boxShadow: '0 0 0 2px var(--terra-tint)',
                  marginTop: '2px',
                } : undefined}
              >
                {!p.important && '•'}
              </span>
              {p.important ? (
                <span className="text-ink-900 font-medium flex-1">
                  <span className="lisna-hl">{p.text}</span>
                </span>
              ) : (
                <span className="text-ink-700 flex-1">{p.text}</span>
              )}
              <TsButton ts={p.ts} onJump={onJump} />
            </li>
          ))}
        </ul>
      )}

      {!compact && section.examples.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] font-mono uppercase tracking-eyebrow text-ink-300 font-medium">
            {T.outline.examples_inline}
          </div>
          <ul className="space-y-1">
            {section.examples.map((ex, i) => (
              <li key={`${ex.text.slice(0, 24)}-${i}`} className="text-xs text-ink-700 leading-relaxed flex gap-2">
                <span className="text-ink-300 shrink-0">→</span>
                <span className="flex-1">{ex.text}</span>
                <TsButton ts={ex.ts} onJump={onJump} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Related terms — DESIGN.md §4.2 §6 mandates these stay
          rendered in markup (Obsidian export needs them as wikilink
          targets) but hidden in the modal where they carry no
          interaction value. */}
      {section.related_terms && section.related_terms.length > 0 && (
        <div className="hidden flex-wrap gap-1 pt-1">
          {section.related_terms.map((term, i) => (
            <span
              key={`${term}-${i}`}
              className="text-[10px] bg-paper-200 text-ink-700 px-1.5 py-0.5 rounded font-medium"
              title={T.outline.relatedTermsTitle}
            >
              {term}
            </span>
          ))}
        </div>
      )}

      {/* Check_question card — neutral paper-200 surface so it reads
          as supplementary, not as competing emphasis with the Take
          card. Hidden in compact mode (the Quiz roll-up at the
          bottom already aggregates these for review). */}
      {!compact && section.check_question && (
        <div className="bg-paper-200 border border-paper-edge px-2.5 py-1.5 rounded-md-design">
          <p className="text-xs text-ink-700 leading-snug">
            <span className="text-[10px] font-mono uppercase tracking-eyebrow text-ink-500 font-semibold mr-1.5">{T.outline.confirm_label}</span>
            {section.check_question}
          </p>
        </div>
      )}

      </>}
    </section>
  )
}

function TsButton({ ts, onJump }: { ts: number; onJump?: (ts: number) => void }) {
  const T = useT()
  if (!onJump) {
    return <span className="text-[10px] text-ink-300 font-mono tabular-nums shrink-0">{fmtTs(ts)}</span>
  }
  // ts chip per DESIGN.md §3.4 — paper-200 surface + paper-edge
  // border + ▶ arrow prefix so the click affordance is obvious in
  // the default state (the previous bare-text version was hard to
  // recognise as interactive). Hover inverts to ink-900 fill.
  return (
    <button
      onClick={() => onJump(ts)}
      className="inline-flex items-center gap-1 text-[10px] text-ink-500 hover:text-paper-100 font-mono tabular-nums shrink-0 transition-colors bg-paper-200 hover:bg-ink-900 border border-paper-edge hover:border-ink-900 rounded px-1.5 py-0.5"
      title={T.outline.tsBackTitle}
    >
      <span aria-hidden className="text-[8px]">▶</span>
      {fmtTs(ts)}
    </button>
  )
}

// Horizontal strip of slide thumbnails captured during this section's ts
// range. Each thumbnail is a button: click = open the slide lightbox at
// that index, lightbox has a "▶ この場面に戻る" button that triggers
// onJump. We deliberately do NOT make the thumbnail itself jump — the
// most common intent ("I want to look at the slide bigger") differs from
// "I want to scrub the video," and conflating them led to misclicks in
// early prototypes.
function SlideStrip({ slides, onJump, onSlideRemove }: { slides: SlideItem[]; onJump?: (ts: number) => void; onSlideRemove?: (key: string) => void }) {
  const T = useT()
  const [openIdx, setOpenIdx] = useState<number | null>(null)
  // Per-slide load failure flag, keyed by slide.key. Lets us hide the
  // entire button (not just the <img>) when a presigned URL has
  // expired, instead of leaving a 96×56 ghost rectangle in the strip.
  const [broken, setBroken] = useState<Record<string, true>>({})

  // Dedupe by key — the WS sometimes redelivers a slide if the modal
  // reconnects mid-session. Sorting by ts gives a chronological strip
  // even if the network reordered packets.
  const uniqSorted = useMemo(() => {
    const seen = new Set<string>()
    const list: SlideItem[] = []
    for (const s of slides) {
      if (seen.has(s.key)) continue
      seen.add(s.key)
      list.push(s)
    }
    list.sort((a, b) => a.ts - b.ts)
    return list
  }, [slides])

  const visibleSlides = useMemo(
    () => uniqSorted.filter(s => !broken[s.key]),
    [uniqSorted, broken],
  )

  if (visibleSlides.length === 0) return null

  return (
    <>
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        {visibleSlides.map((slide) => (
          // Wrapper div so we can add a sibling X-button. The thumbnail
          // itself is still a <button> (lightbox open); HTML doesn't
          // allow nesting <button> inside <button>, hence the sibling
          // pattern. X-button is absolute-positioned on top-right with
          // opacity 0 → 100 on group-hover.
          <div key={slide.key} className="shrink-0 group relative">
            <button
              type="button"
              // Map the click target's position in `visibleSlides` to its
              // index in `uniqSorted` (which is what the lightbox iterates).
              // Without this, broken-and-hidden thumbnails earlier in the
              // strip would offset the lightbox's startIdx and the user
              // would land on the wrong slide.
              onClick={() => setOpenIdx(uniqSorted.findIndex(s => s.key === slide.key))}
              className="rounded overflow-hidden border border-paper-edge hover:border-ink-200 transition-colors focus:outline-none focus:ring-2 focus:ring-ink-900/20"
              title={interpolate(T.outline.slideThumbTitle, { ts: fmtTs(slide.ts) })}
            >
              <img
                src={slide.url}
                alt={`slide ${fmtTs(slide.ts)}`}
                loading="lazy"
                className="block w-24 h-14 object-cover bg-paper-300"
                onError={() => {
                  // Presigned URLs expire after 1 h. Drop the whole
                  // button from the strip instead of showing a
                  // broken-image placeholder. The slide is still in the
                  // session record on the backend; reloading the modal
                  // will fetch fresh URLs.
                  setBroken(prev => prev[slide.key] ? prev : { ...prev, [slide.key]: true })
                }}
              />
              <span className="absolute bottom-0 right-0 bg-black/60 text-white text-[9px] px-1 font-mono leading-snug">
                {fmtTs(slide.ts)}
              </span>
            </button>
            {onSlideRemove && (
              <button
                type="button"
                aria-label="Delete this slide"
                title="이 슬라이드 삭제"
                onClick={(e) => {
                  // stopPropagation prevents the thumbnail's onClick
                  // (lightbox open) from also firing; the two buttons
                  // are siblings but the click visually lands inside
                  // the thumbnail's bounding box at the top-right.
                  e.stopPropagation()
                  onSlideRemove(slide.key)
                }}
                className="absolute -top-2 -right-2 w-4 h-4 flex items-center justify-center rounded-full bg-ink-900/90 hover:bg-warn-red text-paper-100 text-[10px] leading-none opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity z-10 cursor-pointer shadow-sm ring-1 ring-paper-100/60"
              >×</button>
            )}
          </div>
        ))}
      </div>
      {openIdx !== null && (
        <SlideLightbox
          // Pass the FULL deduped list (not the broken-filtered visible
          // list) so the lightbox's idx remains stable when a thumbnail
          // image errors mid-view. Otherwise the array shrinks under
          // the lightbox and arrow navigation lands on a different
          // slide than the user expected. Lightbox does its own
          // image error handling separately.
          slides={uniqSorted}
          startIdx={openIdx}
          onClose={() => setOpenIdx(null)}
          onJump={onJump}
        />
      )}
    </>
  )
}

// Full-bleed slide viewer. Esc / backdrop click closes; arrow keys
// navigate; "▶ 動画のこの場面へ" jumps the underlying video AND closes.
function SlideLightbox({
  slides,
  startIdx,
  onClose,
  onJump,
}: {
  slides: SlideItem[]
  startIdx: number
  onClose: () => void
  onJump?: (ts: number) => void
}) {
  const T = useT()
  const [idx, setIdx] = useState(startIdx)
  const slide = slides[idx]
  const dialogRef = useRef<HTMLDivElement>(null)
  // Capture the element that had focus before the lightbox opened so we
  // can return focus to it on close — required for keyboard / screen-
  // reader users not to lose their place in the outline.
  const returnFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    returnFocusRef.current = document.activeElement as HTMLElement | null
    // Move focus into the dialog so keyboard nav lands somewhere
    // sensible and screen readers announce we've entered a dialog.
    dialogRef.current?.focus()
    return () => {
      returnFocusRef.current?.focus?.()
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
      if (e.key === 'ArrowRight') { e.preventDefault(); setIdx(i => Math.min(slides.length - 1, i + 1)); return }
      if (e.key === 'ArrowLeft') { e.preventDefault(); setIdx(i => Math.max(0, i - 1)); return }
      // Trap Tab inside the dialog so focus doesn't escape into the
      // underlying outline (which is supposed to be modally hidden).
      if (e.key === 'Tab') {
        const dialog = dialogRef.current
        if (!dialog) return
        const focusables = dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        )
        if (focusables.length === 0) { e.preventDefault(); return }
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        const active = document.activeElement
        if (e.shiftKey && active === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [slides.length, onClose])

  if (!slide) return null
  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      className="fixed inset-0 z-[2147483646] bg-black/85 flex flex-col items-center justify-center p-4 outline-none"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={interpolate(T.outline.lightboxAria, {
        i: idx + 1,
        n: slides.length,
        ts: fmtTs(slide.ts),
      })}
    >
      <div
        className="relative max-w-full max-h-full flex flex-col items-center"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={slide.url}
          alt={`slide ${fmtTs(slide.ts)}`}
          className="max-w-full max-h-[80vh] object-contain rounded shadow-2xl"
        />
        <div className="mt-3 flex items-center gap-3 text-white text-xs">
          <button
            type="button"
            onClick={() => setIdx(i => Math.max(0, i - 1))}
            disabled={idx === 0}
            className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 disabled:opacity-30"
            aria-label={T.outline.lightboxPrevAria}
          >
            {T.outline.lightboxPrev}
          </button>
          <span className="font-mono opacity-80">
            {idx + 1} / {slides.length} ・ {fmtTs(slide.ts)}
          </span>
          <button
            type="button"
            onClick={() => setIdx(i => Math.min(slides.length - 1, i + 1))}
            disabled={idx === slides.length - 1}
            className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 disabled:opacity-30"
            aria-label={T.outline.lightboxNextAria}
          >
            {T.outline.lightboxNext}
          </button>
          {onJump && (
            <button
              type="button"
              onClick={() => { onJump(slide.ts); onClose() }}
              className="px-3 py-1 rounded bg-ink-900 hover:bg-ink-900 text-white font-medium"
            >
              {T.outline.lightboxJump}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="px-2 py-1 rounded bg-white/10 hover:bg-white/20"
            aria-label={T.outline.lightboxClose}
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  )
}
