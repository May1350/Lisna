import { useEffect, useState } from 'react'
import { callApi } from '../api-client'
import { useT, interpolate } from '../../shared/i18n'
import type { Translations } from '../../shared/i18n'

// Compact summary of a captured session — matches the backend
// /v1/sessions response shape (sessions-list.ts).
interface SessionSummary {
  id: string
  url: string
  title: string | null
  status: string
  slide_count: number
  has_outline: boolean
  created_at: string
  updated_at: string
}

// Side-panel session history list. The user's recent ~100 sessions,
// most-recently-updated first. Click a row → opens the source URL
// in a new tab; the existing /v1/session?url=… on-page-load hook
// in App.tsx hydrates the modal with the cached outline + slides
// so the user lands directly in their notes for that lecture.
//
// We deliberately keep this READ-ONLY in v1 — no inline rename, no
// delete, no folder organisation. Those are vault-side concerns
// (the user's own filesystem, after .zip / .html download). This
// list is just a "where was I?" navigation aid.
export function SessionHistory() {
  const T = useT()
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const r = await callApi<{ sessions: SessionSummary[] }>('/v1/sessions', 'GET')
        if (!cancelled) setSessions(r.sessions)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'unknown')
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (error) {
    return (
      <div className="px-3 py-3 text-xs text-red-700 bg-red-50 border-y border-red-200">
        {T.sidePanel.historyFetchFailed}{error}
      </div>
    )
  }

  if (sessions === null) {
    return (
      <div className="px-3 py-6 text-xs text-gray-500 text-center">
        <span className="inline-block w-3 h-3 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin align-[-2px] mr-1.5" />
        {T.sidePanel.historyLoading}
      </div>
    )
  }

  if (sessions.length === 0) {
    // Empty-state copy contains a literal "\n" — split and render with
    // <br/> so the locale defines the break point.
    const lines = T.sidePanel.historyEmpty.split('\n')
    return (
      <div className="px-3 py-6 text-xs text-gray-500 text-center leading-relaxed">
        {lines.map((line, i) => (
          <span key={i}>
            {line}
            {i < lines.length - 1 && <br />}
          </span>
        ))}
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <h3 className="px-3 pt-3 pb-1.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
        {interpolate(T.sidePanel.historyHeader, { n: sessions.length })}
      </h3>
      <ul className="divide-y divide-gray-200">
        {sessions.map(s => (
          <SessionRow key={s.id} session={s} T={T} />
        ))}
      </ul>
    </div>
  )
}

function SessionRow({ session, T }: { session: SessionSummary; T: Translations }) {
  // "View in browser" — opens the source video URL. The content script
  // running on that page will auto-load the cached outline via the
  // /v1/session?url=… effect in App.tsx, so the user lands inside
  // the modal with their existing notes already populated.
  const onOpen = () => {
    void chrome.tabs.create({ url: session.url, active: true })
  }
  const title = session.title?.trim() || T.sidePanel.historyTitle_untitled
  const date = formatRelativeDate(session.updated_at, T)
  const meta = session.has_outline
    ? (session.slide_count > 0
        ? interpolate(T.sidePanel.historyMeta_outline_withSlides, { n: session.slide_count })
        : T.sidePanel.historyMeta_withOutline)
    : (session.slide_count > 0
        ? interpolate(T.sidePanel.historyMeta_slidesOnly, { n: session.slide_count })
        : T.sidePanel.historyMeta_recordOnly)
  return (
    <li>
      <button
        onClick={onOpen}
        className="w-full px-3 py-2.5 text-left hover:bg-gray-100 transition flex flex-col gap-0.5 group"
      >
        <span className="text-xs font-medium text-gray-900 line-clamp-2">{title}</span>
        <span className="text-[10px] text-gray-500 flex items-center gap-2">
          <span>{date}</span>
          <span>·</span>
          <span>{meta}</span>
        </span>
        <span className="text-[10px] text-gray-400 truncate group-hover:text-blue-600 transition">
          {hostnameOf(session.url)}
        </span>
      </button>
    </li>
  )
}

function formatRelativeDate(iso: string, T: Translations): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const now = Date.now()
  const diffMs = now - d.getTime()
  const min = Math.floor(diffMs / 60_000)
  if (min < 1) return T.sidePanel.relativeDate.now
  if (min < 60) return interpolate(T.sidePanel.relativeDate.minAgo, { n: min })
  const hr = Math.floor(min / 60)
  if (hr < 24) return interpolate(T.sidePanel.relativeDate.hrAgo, { n: hr })
  const day = Math.floor(hr / 24)
  if (day < 7) return interpolate(T.sidePanel.relativeDate.dayAgo, { n: day })
  // 7+ days — show YYYY-MM-DD for stable reference
  return d.toISOString().slice(0, 10)
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url.slice(0, 40)
  }
}
