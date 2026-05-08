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

export function OutlineView({ outline, slides = [], onJump, displayTitle, outlineUpdatedAt }: Props) {
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
      <div className="flex-1 overflow-y-auto px-3 py-4">
        <p className="text-sm text-gray-500">{T.outline.emptyHint}</p>
      </div>
    )
  }

  return (
    <div className={`flex-1 overflow-y-auto px-3 py-3 space-y-4 transition-colors duration-700 ${flashing ? 'bg-blue-50/60' : 'bg-transparent'}`}>
      <div className="flex items-baseline justify-between gap-2">
        {(displayTitle?.trim() || outline.title) && (
          <h2 className="text-base font-bold text-gray-900 leading-snug">
            {displayTitle?.trim() || outline.title}
          </h2>
        )}
        {outlineUpdatedAt != null && (
          <RefreshIndicator at={outlineUpdatedAt} />
        )}
      </div>
      <SectionList outline={outline} slides={slides} onJump={onJump} />
      {/* SectionList memoizes the per-section slide bucketing so we
          don't re-traverse both arrays on every parent render. */}
    </div>
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
}: {
  outline: Outline
  slides: SlideItem[]
  onJump?: (ts: number) => void
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
        />
      ))}
    </>
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
      className="text-[10px] text-blue-500 font-medium shrink-0 whitespace-nowrap"
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
}: {
  section: OutlineSection
  slides?: SlideItem[]
  onJump?: (ts: number) => void
}) {
  const T = useT()
  // Phase 6 optional fields (takeaway / related_terms / check_question)
  // are now part of the typed OutlineSection — no more `as` cast. UI
  // renders them as plain text; the markdown export pipeline handles
  // their wikilink/callout formatting separately.
  return (
    <section className="space-y-2 border-l-2 border-blue-200 pl-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900 leading-snug">
          {section.heading}
        </h3>
        <TsButton ts={section.ts} onJump={onJump} />
      </div>

      {slides.length > 0 && <SlideStrip slides={slides} onJump={onJump} />}

      {section.takeaway && (
        <div className="bg-blue-50/60 border-l-2 border-blue-300 pl-2 pr-2 py-1 rounded-r">
          <p className="text-xs text-gray-800 leading-snug">
            <span className="text-[10px] uppercase tracking-wider text-blue-500 font-medium mr-1">{T.outline.summary_label}</span>
            {section.takeaway}
          </p>
        </div>
      )}

      {section.summary && !section.takeaway && (
        <p className="text-xs text-gray-600 leading-relaxed italic">
          {section.summary}
        </p>
      )}

      {section.key_terms.length > 0 && (
        <ul className="space-y-1.5">
          {section.key_terms.map((kt, i) => (
            <li
              key={`${kt.term}-${i}`}
              className="bg-amber-50 border border-amber-100 rounded px-2 py-1.5 text-xs"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold text-amber-900">{kt.term}</span>
                <TsButton ts={kt.ts} onJump={onJump} />
              </div>
              <div className="text-gray-700 mt-0.5 leading-relaxed">
                {kt.definition}
              </div>
            </li>
          ))}
        </ul>
      )}

      {section.points.length > 0 && (
        <ul className="space-y-1">
          {section.points.map((p, i) => (
            <li key={`${p.text.slice(0, 24)}-${i}`} className="text-xs leading-relaxed flex gap-2">
              <span className={p.important ? 'text-amber-600 shrink-0' : 'text-gray-400 shrink-0'}>
                {p.important ? '★' : '•'}
              </span>
              <span className={p.important ? 'text-gray-900 font-medium' : 'text-gray-700'}>
                {p.text}
              </span>
              <TsButton ts={p.ts} onJump={onJump} />
            </li>
          ))}
        </ul>
      )}

      {section.examples.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">
            {T.outline.examples_inline}
          </div>
          <ul className="space-y-1">
            {section.examples.map((ex, i) => (
              <li key={`${ex.text.slice(0, 24)}-${i}`} className="text-xs text-gray-600 leading-relaxed flex gap-2">
                <span className="text-gray-300 shrink-0">→</span>
                <span>{ex.text}</span>
                <TsButton ts={ex.ts} onJump={onJump} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {section.related_terms && section.related_terms.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1">
          {section.related_terms.map((term, i) => (
            <span
              key={`${term}-${i}`}
              className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded font-medium"
              title={T.outline.relatedTermsTitle}
            >
              {term}
            </span>
          ))}
        </div>
      )}

      {section.check_question && (
        <div className="bg-purple-50/60 border-l-2 border-purple-300 pl-2 pr-2 py-1 rounded-r">
          <p className="text-xs text-gray-800 leading-snug">
            <span className="text-[10px] uppercase tracking-wider text-purple-500 font-medium mr-1">{T.outline.confirm_label}</span>
            {section.check_question}
          </p>
        </div>
      )}
    </section>
  )
}

function TsButton({ ts, onJump }: { ts: number; onJump?: (ts: number) => void }) {
  const T = useT()
  if (!onJump) {
    return <span className="text-[10px] text-gray-400 font-mono shrink-0">{fmtTs(ts)}</span>
  }
  return (
    <button
      onClick={() => onJump(ts)}
      className="text-[10px] text-gray-400 hover:text-blue-600 font-mono shrink-0 transition-colors"
      title={T.outline.tsBackTitle}
    >
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
function SlideStrip({ slides, onJump }: { slides: SlideItem[]; onJump?: (ts: number) => void }) {
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
          <button
            key={slide.key}
            type="button"
            // Map the click target's position in `visibleSlides` to its
            // index in `uniqSorted` (which is what the lightbox iterates).
            // Without this, broken-and-hidden thumbnails earlier in the
            // strip would offset the lightbox's startIdx and the user
            // would land on the wrong slide.
            onClick={() => setOpenIdx(uniqSorted.findIndex(s => s.key === slide.key))}
            className="shrink-0 group relative rounded overflow-hidden border border-gray-200 hover:border-blue-400 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-300"
            title={interpolate(T.outline.slideThumbTitle, { ts: fmtTs(slide.ts) })}
          >
            <img
              src={slide.url}
              alt={`slide ${fmtTs(slide.ts)}`}
              loading="lazy"
              className="block w-24 h-14 object-cover bg-gray-100"
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
              className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium"
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
