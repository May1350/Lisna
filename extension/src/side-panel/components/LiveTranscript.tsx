import { useEffect, useRef } from 'react'
import type { LiveTranscriptItem } from '../api-client'

// Live transcript track. Renders the raw STT output below the curated
// note list so the user sees text within ~1 s of speech (instead of the
// full ~12 s STT+LLM round trip). De-emphasised styling — these are not
// the final notes, just a "captions" surface to confirm the pipeline is
// working and let the user follow along.
//
// Self-scrolls to the bottom on each new item, matching the behaviour of
// most chat / live-caption surfaces.

function fmtTs(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

export function LiveTranscript({ items }: { items: LiveTranscriptItem[] }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [items])

  if (items.length === 0) return null

  return (
    <div className="border-t border-gray-200 bg-gray-100/60 px-3 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wider text-gray-400 mb-1">
        ライブ字幕
      </div>
      <div
        ref={scrollRef}
        className="max-h-32 overflow-y-auto text-xs text-gray-500 leading-relaxed space-y-1 pr-1"
      >
        {items.map((it, i) => (
          <p key={`${it.ts}-${i}`}>
            <span className="text-gray-300 mr-1">[{fmtTs(it.ts)}]</span>
            {it.text}
          </p>
        ))}
      </div>
    </div>
  )
}
