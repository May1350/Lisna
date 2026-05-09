import { useEffect, useRef, useState } from 'react'
import type { LiveTranscriptItem } from '../api-client'
import { useT } from '../../shared/i18n'
import type { Translations } from '../../shared/i18n'

// Live transcript track. Renders the raw STT output below the curated
// note list so the user sees text within ~1 s of speech (instead of the
// full ~12 s STT+LLM round trip). De-emphasised styling — these are not
// the final notes, just a "captions" surface to confirm the pipeline is
// working and let the user follow along.
//
// Self-scrolls to the bottom on each new item, matching the behaviour of
// most chat / live-caption surfaces.
//
// Empty-state UX: instead of being entirely invisible (which made users
// think the pipeline was broken), we render a video-state-aware
// placeholder once a session is active:
//   videoPlaying === true   → "🎙️ 음성 처리 중…"   (waiting for first chunk)
//   videoPlaying === false  → "⏸ 동영상이 정지 중"  (no audio is being captured)
//   videoPlaying === null   → "강의 재생을 기다리는 중…" (state unknown yet)

function fmtTs(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

interface Props {
  items: LiveTranscriptItem[]
  /** Whether the underlying <video> element is currently playing.
   *  null = unknown (haven't received a state broadcast yet). */
  videoPlaying?: boolean | null
}

// Empty-state placeholder — no emoji per DESIGN.md (Concept 1+).
// Tone color matches the status dot above so the two signals
// reinforce: ok-green when recording, ink-500 when paused, ink-300
// when waiting.
function placeholderFor(
  playing: boolean | null | undefined,
  T: Translations,
): { text: string; tone: string } {
  if (playing === true) {
    return { text: T.liveTranscript.placeholder_processing, tone: 'text-ok-green' }
  }
  if (playing === false) {
    return { text: T.liveTranscript.placeholder_paused, tone: 'text-ink-500' }
  }
  return { text: T.liveTranscript.placeholder_idle, tone: 'text-ink-300' }
}

// Threshold for "user is at the bottom of the scroll area". Auto-scroll
// is suppressed when they've scrolled up beyond this margin so we don't
// yank them away from older captions they're trying to read.
const STICK_TO_BOTTOM_MARGIN_PX = 50

// chrome.storage key for the user's collapse preference. Persisted so
// a user who prefers minimal-captions mode keeps that preference
// across modal close/reopen and across days. Lazy hydration: we
// render expanded by default and flip to collapsed after the storage
// read returns — the brief flash is acceptable trade-off for SSR-
// like state initialisation simplicity.
const COLLAPSED_STORAGE_KEY = 'sh.captionsCollapsed'

export function LiveTranscript({ items, videoPlaying = null }: Props) {
  const T = useT()
  const scrollRef = useRef<HTMLDivElement>(null)
  // Track whether the user is "stuck to the bottom" — the typical
  // chat/captions UX. Initial true so the first batch auto-scrolls
  // into view. Updated on scroll: if they drift up beyond the margin
  // we flip to false; if they scroll back to the bottom we flip back.
  const stickToBottomRef = useRef(true)

  // Collapse state per DESIGN.md §7 C4. Panel-dock chevron pattern
  // (DESIGN.md §3.5): ▼ when expanded ("click to collapse this panel
  // away"), ▲ when collapsed ("click to bring the panel back").
  const [collapsed, setCollapsed] = useState(false)
  useEffect(() => {
    void chrome.storage.local.get(COLLAPSED_STORAGE_KEY).then((r) => {
      if (r[COLLAPSED_STORAGE_KEY] === true) setCollapsed(true)
    })
  }, [])
  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c
      void chrome.storage.local.set({ [COLLAPSED_STORAGE_KEY]: next })
      return next
    })
  }

  const onScroll = (): void => {
    const el = scrollRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    stickToBottomRef.current = distanceFromBottom <= STICK_TO_BOTTOM_MARGIN_PX
  }

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (stickToBottomRef.current) el.scrollTop = el.scrollHeight
  }, [items])

  const { text, tone } = placeholderFor(videoPlaying, T)

  return (
    <div className="border-t border-paper-edge bg-paper-200 px-3 py-2">
      <div className={`flex items-center justify-between gap-2 ${collapsed ? '' : 'mb-1'}`}>
        <span className="text-[10px] font-mono font-medium uppercase tracking-eyebrow text-ink-300 shrink-0">
          {T.liveTranscript.header}
        </span>
        {/* Tiny play/pause status pill so the user can see at a glance
            whether audio is currently flowing. Hidden when unknown. */}
        <span className="flex-1 flex items-center justify-end gap-1.5 min-w-0">
          {videoPlaying === true && (
            <span className="text-[10px] font-mono text-ok-green flex items-center gap-1 shrink-0">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-ok-green animate-pulse" />
              {T.liveTranscript.statusRecordingShort}
            </span>
          )}
          {videoPlaying === false && (
            <span className="text-[10px] font-mono text-ink-500 shrink-0">{T.liveTranscript.statusPausedShort}</span>
          )}
        </span>
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={collapsed ? T.liveTranscript.expandAria : T.liveTranscript.collapseAria}
          title={collapsed ? T.liveTranscript.expandTitle : T.liveTranscript.collapseTitle}
          className="shrink-0 w-5 h-5 flex items-center justify-center text-ink-300 hover:text-ink-700 hover:bg-paper-300 rounded transition-colors"
        >
          <svg
            width="12" height="12" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
            aria-hidden="true"
            style={{ transition: 'transform 220ms ease', transform: collapsed ? 'rotate(180deg)' : 'rotate(0deg)' }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>

      {!collapsed && (items.length === 0 ? (
        <div className={`text-xs ${tone} py-2`}>
          {text}
        </div>
      ) : (
        <div
          ref={scrollRef}
          onScroll={onScroll}
          // aria-live=polite + aria-atomic=false: screen readers
          // announce only newly-added text (not the entire region) when
          // a chunk arrives, matching how sighted users perceive the
          // streaming captions surface.
          aria-live="polite"
          aria-atomic="false"
          aria-label={T.liveTranscript.header}
          role="log"
          className="lisna-scroll max-h-32 overflow-y-auto text-xs text-ink-500 leading-relaxed space-y-1 pr-1"
        >
          {items.map((it, i) => (
            <p key={`${it.ts}-${i}`}>
              <span className="text-ink-300 font-mono tabular-nums mr-1">[{fmtTs(it.ts)}]</span>
              {it.text}
            </p>
          ))}
        </div>
      ))}
    </div>
  )
}
