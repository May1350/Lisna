import { useEffect, useRef } from 'react'
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

function placeholderFor(
  playing: boolean | null | undefined,
  T: Translations,
): { icon: string; text: string; tone: string } {
  if (playing === true) {
    return {
      icon: '🎙️',
      text: T.liveTranscript.placeholder_processing,
      tone: 'text-blue-600',
    }
  }
  if (playing === false) {
    return {
      icon: '⏸',
      text: T.liveTranscript.placeholder_paused,
      tone: 'text-gray-500',
    }
  }
  return {
    icon: '⏳',
    text: T.liveTranscript.placeholder_idle,
    tone: 'text-gray-400',
  }
}

// Threshold for "user is at the bottom of the scroll area". Auto-scroll
// is suppressed when they've scrolled up beyond this margin so we don't
// yank them away from older captions they're trying to read.
const STICK_TO_BOTTOM_MARGIN_PX = 50

export function LiveTranscript({ items, videoPlaying = null }: Props) {
  const T = useT()
  const scrollRef = useRef<HTMLDivElement>(null)
  // Track whether the user is "stuck to the bottom" — the typical
  // chat/captions UX. Initial true so the first batch auto-scrolls
  // into view. Updated on scroll: if they drift up beyond the margin
  // we flip to false; if they scroll back to the bottom we flip back.
  const stickToBottomRef = useRef(true)

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

  const { icon, text, tone } = placeholderFor(videoPlaying, T)

  return (
    <div className="border-t border-gray-200 bg-gray-100/60 px-3 py-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-medium uppercase tracking-wider text-gray-400">
          {T.liveTranscript.header}
        </span>
        {/* Tiny play/pause status pill so the user can see at a glance
            whether audio is currently flowing. Hidden when unknown. */}
        {videoPlaying === true && (
          <span className="text-[10px] text-emerald-600 flex items-center gap-1">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            {T.liveTranscript.statusRecordingShort}
          </span>
        )}
        {videoPlaying === false && (
          <span className="text-[10px] text-gray-500">{T.liveTranscript.statusPausedShort}</span>
        )}
      </div>

      {items.length === 0 ? (
        <div className={`text-xs ${tone} flex items-center gap-2 py-2`}>
          <span aria-hidden>{icon}</span>
          <span>{text}</span>
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
          className="max-h-32 overflow-y-auto text-xs text-gray-500 leading-relaxed space-y-1 pr-1"
        >
          {items.map((it, i) => (
            <p key={`${it.ts}-${i}`}>
              <span className="text-gray-300 mr-1">[{fmtTs(it.ts)}]</span>
              {it.text}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
