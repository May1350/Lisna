import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { callApi, ApiError } from '../api-client'
import { useT, interpolate } from '../../shared/i18n'
import type { Translations } from '../../shared/i18n'
import { reportError } from '../../shared/errors'
import { ExternalLinkIcon } from './icons'

// Compact summary of a captured session — matches the backend
// /v1/sessions response shape (sessions-list.ts).
export interface SessionSummary {
  id: string
  url: string
  title: string | null
  status: string
  slide_count: number
  has_outline: boolean
  created_at: string
  updated_at: string
}

// Thresholds (spec):
//   - Search bar appears when sessions.length >= 8
//   - Time grouping appears when sessions.length >= 5
const SEARCH_THRESHOLD = 8
const GROUP_THRESHOLD = 5
const FAILURE_GIVE_UP = 3

type Bucket = 'today' | 'yesterday' | 'thisWeek' | 'thisMonth' | 'earlier'

interface Props {
  /** Called when a request returns 401, so the parent can drop user state
   *  and re-show the login screen. We render nothing in that case. */
  onAuthExpired?: () => void
  /** Called when the user clicks a row to view its saved notes inline.
   *  When omitted, the row falls back to opening the source URL in a
   *  new tab (legacy behaviour). */
  onView?: (session: SessionSummary) => void
}

// Side-panel session history list. The user's recent ~100 sessions,
// most-recently-updated first. Row click → onView(session) opens the
// notes inline (NotesViewer takes over the side-panel surface). The
// per-row external-link icon still opens the source URL in a new tab
// for callers who want to jump back to the video.
export function SessionHistory({ onAuthExpired, onView }: Props) {
  const T = useT()
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null)
  const [error, setError] = useState<{ message: string; status?: number } | null>(null)
  const [failureCount, setFailureCount] = useState(0)
  const [reloading, setReloading] = useState(false)
  // Animated background-reload bar fades in only after 250 ms — avoids
  // flicker on instant responses.
  const [showReloadBar, setShowReloadBar] = useState(false)
  // Search query (no debounce — list bounded at 100).
  const [query, setQuery] = useState('')
  // Inline-confirm row id (or null = no confirm open).
  const [confirmId, setConfirmId] = useState<string | null>(null)
  // Row id transiently flashed after a failed delete (re-insert flash).
  const [flashId, setFlashId] = useState<string | null>(null)
  // Keyboard navigation focus index against the FILTERED+sorted list.
  const [focusIndex, setFocusIndex] = useState<number | null>(null)

  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const rowRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const containerRef = useRef<HTMLDivElement | null>(null)
  const reloadTimerRef = useRef<number | null>(null)

  const loadSessions = useCallback(async (background: boolean) => {
    if (background) {
      setReloading(true)
      // Fade in the reload bar after 250 ms — not instant, to dodge flicker.
      reloadTimerRef.current = window.setTimeout(() => setShowReloadBar(true), 250)
    }
    try {
      const r = await callApi<{ sessions: SessionSummary[] }>('/v1/sessions', 'GET')
      setSessions(r.sessions)
      setError(null)
      setFailureCount(0)
    } catch (e) {
      // 401: propagate up. Parent clears user → re-shows LoginScreen.
      if (e instanceof ApiError && e.status === 401) {
        onAuthExpired?.()
        return
      }
      const message = e instanceof Error ? e.message : 'unknown'
      const status = e instanceof ApiError ? e.status : undefined
      setError({ message, status })
      setFailureCount(c => c + 1)
    } finally {
      if (reloadTimerRef.current !== null) {
        window.clearTimeout(reloadTimerRef.current)
        reloadTimerRef.current = null
      }
      setReloading(false)
      setShowReloadBar(false)
    }
  }, [onAuthExpired])

  // Initial load.
  useEffect(() => {
    void loadSessions(false)
    return () => {
      if (reloadTimerRef.current !== null) {
        window.clearTimeout(reloadTimerRef.current)
        reloadTimerRef.current = null
      }
    }
  }, [loadSessions])

  // Listen for SP_BROADCAST `outline_updated` (most useful refresh trigger
  // — fires after every curate completes). Soft refresh keeps existing
  // rows visible.
  useEffect(() => {
    const listener = (msg: { type?: string; payload?: { type?: string } }) => {
      if (msg?.type !== 'SP_BROADCAST') return
      const kind = (msg.payload?.type ?? '').toLowerCase()
      if (kind === 'outline_updated') {
        void loadSessions(true)
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [loadSessions])

  // Keyboard "/" focuses search input when no other input is focused.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== '/') return
      const active = document.activeElement
      const isInput =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active instanceof HTMLElement && active.isContentEditable)
      if (isInput) return
      if (searchInputRef.current) {
        e.preventDefault()
        searchInputRef.current.focus()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Filter (case-insensitive substring on title + hostname).
  const visibleSessions = useMemo<SessionSummary[]>(() => {
    if (!sessions) return []
    const q = query.trim().toLowerCase()
    if (!q) return sessions
    return sessions.filter(s => {
      const title = (s.title ?? '').toLowerCase()
      const host = hostnameOf(s.url).toLowerCase()
      return title.includes(q) || host.includes(q)
    })
  }, [sessions, query])

  // Group rows by bucket (only when grouping is active).
  const grouped = useMemo(() => {
    return groupByBucket(visibleSessions)
  }, [visibleSessions])

  // Optimistic-delete handler: remove immediately, restore on failure.
  // Captures the absolute index from the unfiltered `sessions` array
  // inside the setter callback so that a rollback restores the row at
  // the correct position even when the user is currently filtering /
  // when bucket grouping has reshuffled the visible order.
  const onDeleteConfirmed = useCallback(async (s: SessionSummary) => {
    setConfirmId(null)
    let absoluteIdx = -1
    setSessions(prev => {
      if (!prev) return prev
      absoluteIdx = prev.findIndex(x => x.id === s.id)
      return prev.filter(x => x.id !== s.id)
    })
    try {
      await callApi('/v1/session/' + encodeURIComponent(s.id), 'DELETE')
      // 200/204 — silent. Nothing to do.
    } catch (e) {
      // 401: parent handles.
      if (e instanceof ApiError && e.status === 401) {
        onAuthExpired?.()
        return
      }
      // 404 = "already deleted (e.g. another tab beat us to it) or never
      // existed". Backend collapses both to 404 to avoid leaking which.
      // From the user's perspective the row is gone — the optimistic
      // removal we already did is the correct end state. Suppress the
      // rollback + error toast.
      if (e instanceof ApiError && e.status === 404) {
        return
      }
      // Re-insert at original (absolute) index + flash + report toast.
      setSessions(prev => {
        if (!prev) return prev
        const next = [...prev]
        const safeIdx = absoluteIdx >= 0 ? Math.min(absoluteIdx, next.length) : 0
        next.splice(safeIdx, 0, s)
        return next
      })
      setFlashId(s.id)
      window.setTimeout(() => {
        setFlashId(curr => (curr === s.id ? null : curr))
      }, 4000)
      void reportError(e instanceof Error ? e : new Error(String(e)), {
        context: 'SessionHistory:delete',
        severity: 'error',
        metadata: { sessionId: s.id },
      })
    }
  }, [onAuthExpired])

  // ── Render branches ─────────────────────────────────────────────────

  // 401 case: render nothing — parent handles UX.
  // (We never set local state for 401 since onAuthExpired is invoked
  // immediately and parent unmounts us, but the explicit early-return
  // documents the contract.)

  // Initial loading: skeleton list.
  if (sessions === null && !error) {
    return <SkeletonList />
  }

  // Hard error (no list yet OR existing list with retry exhausted).
  if (error && sessions === null) {
    return (
      <ErrorCard
        T={T}
        error={error}
        retriesUsed={failureCount}
        onRetry={() => void loadSessions(false)}
      />
    )
  }

  // sessions is not null past this point.
  const list = sessions!

  // Empty state (no sessions, no query).
  if (list.length === 0) {
    return <EmptyState T={T} />
  }

  const showSearch = list.length >= SEARCH_THRESHOLD
  const showGrouping = list.length >= GROUP_THRESHOLD && query.trim() === ''

  const handleRowKeyNav = (e: React.KeyboardEvent, idx: number) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = Math.min(idx + 1, visibleSessions.length - 1)
      setFocusIndex(next)
      const target = visibleSessions[next]
      if (target) rowRefs.current.get(target.id)?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const next = Math.max(idx - 1, 0)
      setFocusIndex(next)
      const target = visibleSessions[next]
      if (target) rowRefs.current.get(target.id)?.focus()
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      const target = visibleSessions[idx]
      if (target) setConfirmId(target.id)
    }
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto relative">
      {/* Background reload indicator (top thin bar). */}
      {reloading && showReloadBar && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-ink-900 animate-pulse pointer-events-none z-10" />
      )}

      {/* Inline-card error variant: shown when we already have a list AND
       *  the latest reload failed. Sits above the list. */}
      {error && (
        <ErrorCard
          T={T}
          error={error}
          retriesUsed={failureCount}
          onRetry={() => void loadSessions(true)}
        />
      )}

      <h3 className="px-3 pt-3 pb-1.5 text-[11px] font-semibold text-ink-500 uppercase tracking-wide">
        {interpolate(T.sidePanel.historyHeader, { n: list.length })}
      </h3>

      {showSearch && (
        // Search input: deliberately NOT sticky — scrolls with the list.
        <div className="relative">
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setQuery('')
                e.currentTarget.blur()
              }
            }}
            placeholder={T.sidePanel.searchPlaceholder}
            aria-label={T.sidePanel.searchPlaceholder}
            className="w-[calc(100%-1.5rem)] h-7 pl-7 pr-3 py-1.5 mx-3 mt-1 text-xs rounded-md bg-paper-300 border border-transparent focus:bg-paper-100 focus:border-terra focus:ring-2 focus:ring-terra-soft focus:outline-none transition"
          />
          <SearchIcon />
        </div>
      )}

      {/* Empty search result. */}
      {visibleSessions.length === 0 && query.trim() !== '' && (
        <div className="text-xs text-ink-500 py-8 text-center px-3">
          <p>{interpolate(T.sidePanel.searchEmpty, { q: query.trim() })}</p>
          <button
            onClick={() => {
              setQuery('')
              searchInputRef.current?.focus()
            }}
            className="mt-2 text-xs text-ink-900 hover:text-terra-700 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra focus-visible:ring-offset-1 rounded"
          >
            {T.sidePanel.searchClear}
          </button>
        </div>
      )}

      {/* The list itself — grouped or flat.
       *
       * Keyboard navigation works on the on-screen order, so we flatten
       * the grouped buckets in render order ONCE up front and use that
       * flat array's index for ↑/↓ nav + tabIndex roving. Looking up
       * by `visibleSessions.findIndex(...)` per row was O(n²) AND
       * yielded the wrong order when buckets reshuffle items across
       * groups (so ↑/↓ between adjacent on-screen rows could skip).
       */}
      {visibleSessions.length > 0 && (() => {
        const flatOrder: SessionSummary[] = showGrouping
          ? (['today', 'yesterday', 'thisWeek', 'thisMonth', 'earlier'] as Bucket[]).flatMap(b => grouped[b])
          : visibleSessions
        const idxById = new Map<string, number>()
        flatOrder.forEach((s, i) => idxById.set(s.id, i))
        const rowProps = (s: SessionSummary) => {
          const idx = idxById.get(s.id) ?? 0
          return {
            key: s.id,
            session: s,
            T,
            isFlashing: flashId === s.id,
            isConfirming: confirmId === s.id,
            onView,
            onRequestConfirm: () => setConfirmId(s.id),
            onCancelConfirm: () => setConfirmId(null),
            onConfirmDelete: () => void onDeleteConfirmed(s),
            registerRef: (el: HTMLButtonElement | null) => {
              if (el) rowRefs.current.set(s.id, el)
              else rowRefs.current.delete(s.id)
            },
            onKeyNav: (e: React.KeyboardEvent) => handleRowKeyNav(e, idx),
            onFocus: () => setFocusIndex(idx),
            tabIndex: focusIndex === idx || (focusIndex === null && idx === 0) ? 0 : -1,
          }
        }

        return showGrouping ? (
          <div>
            {(['today', 'yesterday', 'thisWeek', 'thisMonth', 'earlier'] as Bucket[]).map(bucket => {
              const items = grouped[bucket]
              if (items.length === 0) return null
              return (
                <div key={bucket}>
                  <div className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-300 bg-paper-200/60">
                    {bucketLabel(bucket, T)}
                  </div>
                  <ul className="divide-y divide-gray-200">
                    {items.map(s => <SessionRow {...rowProps(s)} />)}
                  </ul>
                </div>
              )
            })}
          </div>
        ) : (
          <ul className="divide-y divide-gray-200">
            {visibleSessions.map(s => <SessionRow {...rowProps(s)} />)}
          </ul>
        )
      })()}
    </div>
  )
}

// ── Subcomponents ─────────────────────────────────────────────────────

function SessionRow({
  session, T, isFlashing, isConfirming, onView,
  onRequestConfirm, onCancelConfirm, onConfirmDelete,
  registerRef, onKeyNav, onFocus, tabIndex,
}: {
  session: SessionSummary
  T: Translations
  isFlashing: boolean
  isConfirming: boolean
  onView?: (session: SessionSummary) => void
  onRequestConfirm: () => void
  onCancelConfirm: () => void
  onConfirmDelete: () => void
  registerRef: (el: HTMLButtonElement | null) => void
  onKeyNav: (e: React.KeyboardEvent) => void
  onFocus: () => void
  tabIndex: number
}) {
  // Primary row click → view notes inline. Falls back to opening the
  // source URL if no onView handler is wired (lets this component
  // continue to work standalone without NotesViewer plumbing).
  const onPrimary = () => {
    if (onView) onView(session)
    else void chrome.tabs.create({ url: session.url, active: true })
  }
  const onOpenSource = () => {
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

  const flashClass = isFlashing ? 'bg-warn-amber/10 ring-1 ring-warn-amber/40' : ''

  return (
    <li className={`relative group ${flashClass}`}>
      {/* Main button — sibling, NOT nested with the trash icon. */}
      <button
        ref={registerRef}
        onClick={onPrimary}
        onKeyDown={onKeyNav}
        onFocus={onFocus}
        tabIndex={tabIndex}
        className="w-full px-3 py-2.5 pr-16 text-left hover:bg-paper-200 transition flex flex-col gap-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra focus-visible:ring-offset-1"
      >
        <span className="text-xs font-medium text-ink-900 line-clamp-2">{title}</span>
        {/* Hide the meta line while inline-confirm is showing. */}
        {!isConfirming && (
          <>
            <span className="text-[10px] text-ink-500 flex items-center gap-2">
              <span>{date}</span>
              <span>·</span>
              <span>{meta}</span>
            </span>
            <span className="text-[10px] text-ink-300 truncate group-hover:text-ink-900 transition">
              {hostnameOf(session.url)}
            </span>
          </>
        )}
      </button>

      {/* Per-row open-source-video icon — primary click is now "view
          notes", so this keeps source-video access one click away
          without overloading the row. Sibling of the trash icon. */}
      {!isConfirming && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onOpenSource()
          }}
          aria-label={T.sidePanel.openSourceAria}
          title={T.sidePanel.openSourceAria}
          className="absolute top-2 right-9 p-1 rounded text-ink-300 hover:text-ink-900 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 max-[360px]:opacity-100 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra focus-visible:ring-offset-1"
        >
          <ExternalLinkIcon size={14} />
        </button>
      )}

      {/* Per-row trash icon — sibling, hover-revealed. */}
      {!isConfirming && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onRequestConfirm()
          }}
          aria-label={T.sidePanel.deleteAria}
          title={T.sidePanel.deleteAria}
          className="absolute top-2 right-2 p-1 rounded text-ink-300 hover:text-warn-red opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 max-[360px]:opacity-100 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra focus-visible:ring-offset-1"
        >
          <TrashIcon />
        </button>
      )}

      {/* Inline confirm strip — replaces the meta line. */}
      {isConfirming && (
        <ConfirmStrip
          T={T}
          onCancel={onCancelConfirm}
          onConfirm={onConfirmDelete}
        />
      )}
    </li>
  )
}

function ConfirmStrip({
  T, onCancel, onConfirm,
}: {
  T: Translations
  onCancel: () => void
  onConfirm: () => void
}) {
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  const confirmRef = useRef<HTMLButtonElement | null>(null)
  // Autofocus Cancel — destructive defaults are bad.
  useEffect(() => {
    cancelRef.current?.focus()
  }, [])

  // Esc cancels; Enter on either button delegates to that button's
  // native click; Enter elsewhere in the strip cancels (cancel-default).
  // The previous version intercepted Enter even when the Confirm button
  // was focused, which made keyboard-only confirm impossible (Space
  // worked, Enter didn't).
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onCancel()
    } else if (e.key === 'Enter') {
      const active = document.activeElement
      if (active === cancelRef.current || active === confirmRef.current) {
        // Let the focused button handle its own Enter natively.
        return
      }
      // Strip has focus but neither button does (rare — focus on the
      // wrapping <div>) → cancel-default.
      e.preventDefault()
      e.stopPropagation()
      onCancel()
    }
  }

  return (
    <div
      className="bg-warn-red/5 border-l-2 border-warn-red px-3 py-2 mx-0 mt-0 flex items-center gap-2"
      onKeyDown={onKeyDown}
      role="alertdialog"
      aria-label={T.sidePanel.deleteConfirmBody}
    >
      <p className="flex-1 text-[11px] text-warn-red leading-snug">
        {T.sidePanel.deleteConfirmBody}
      </p>
      <button
        ref={cancelRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); onCancel() }}
        className="bg-paper-100 border border-paper-edge text-ink-700 text-[11px] px-2 py-0.5 rounded hover:bg-paper-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra focus-visible:ring-offset-1"
      >
        {T.common.cancel}
      </button>
      <button
        ref={confirmRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); onConfirm() }}
        className="bg-warn-red text-white text-[11px] px-2 py-0.5 rounded hover:bg-warn-red focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warn-red/40 focus-visible:ring-offset-1"
      >
        {T.sidePanel.deleteConfirm}
      </button>
    </div>
  )
}

function SkeletonList() {
  return (
    <div className="flex-1 overflow-hidden">
      <ul className="divide-y divide-gray-200">
        {[0, 1, 2].map(i => (
          <li key={i} className="px-3 py-2.5">
            <div className="h-3 w-3/4 bg-ink-200 rounded animate-pulse" />
            <div className="h-2 w-1/2 mt-1.5 bg-ink-200 rounded animate-pulse" />
            <div className="h-2 w-1/3 mt-1 bg-ink-200 rounded animate-pulse" />
          </li>
        ))}
      </ul>
    </div>
  )
}

function ErrorCard({
  T, error, retriesUsed, onRetry,
}: {
  T: Translations
  error: { message: string; status?: number }
  retriesUsed: number
  onRetry: () => void
}) {
  const exhausted = retriesUsed >= FAILURE_GIVE_UP
  const headline = exhausted
    ? T.sidePanel.historyFetchFailedAgain
    : T.sidePanel.historyFetchFailed
  const detail = error.status ? `HTTP ${error.status} — ${error.message}` : error.message
  return (
    <div className="mx-3 mt-3 p-3 rounded-md bg-warn-red/5 border border-warn-red/30 flex flex-col gap-2">
      <div>
        <p className="text-xs text-warn-red">{headline}</p>
        <p className="text-[10px] text-warn-red mt-1 font-mono break-all">{detail}</p>
      </div>
      {!exhausted && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onRetry}
            className="text-xs px-3 py-1 rounded bg-paper-100 border border-warn-red/40 text-warn-red hover:bg-warn-red/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warn-red/40 focus-visible:ring-offset-1"
          >
            {T.common.retry}
          </button>
        </div>
      )}
    </div>
  )
}

function EmptyState({ T }: { T: Translations }) {
  return (
    <div className="px-6 py-10 text-center">
      <div className="flex justify-center mb-3 text-terra-soft">
        <DocumentSparkleIcon />
      </div>
      <p className="text-sm font-medium text-ink-700">{T.sidePanel.historyEmpty_title}</p>
      <p className="text-xs text-ink-500 leading-relaxed mt-1">{T.sidePanel.historyEmpty_body}</p>
      <div className="mt-4 inline-flex items-center gap-1.5 bg-terra-tint text-terra-700 px-2 py-0.5 rounded-full text-[11px]">
        <ArrowUpIcon />
        <span>{T.sidePanel.inlineHintIcon}</span>
      </div>
    </div>
  )
}

// ── Inline SVG glyphs ─────────────────────────────────────────────────

// Search magnifier — leading inline-SVG inside the input.
function SearchIcon() {
  return (
    <svg
      width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
      className="absolute left-[1.05rem] top-1/2 -translate-y-1/2 text-ink-300 pointer-events-none"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.35-3.35" />
    </svg>
  )
}

// 14px trash — minimal stroke style, matches GearIcon language.
function TrashIcon() {
  return (
    <svg
      width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  )
}

// Empty-state glyph: 40×40 outlined document with sparkle overlay.
function DocumentSparkleIcon() {
  return (
    <svg
      width="40" height="40" viewBox="0 0 40 40" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Document */}
      <path d="M9 6h14l6 6v22a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" />
      <path d="M23 6v6h6" />
      <path d="M12 20h12" />
      <path d="M12 25h10" />
      <path d="M12 30h7" />
      {/* Sparkle */}
      <path d="M30 14 31.4 17 34.4 18.4 31.4 19.8 30 22.8 28.6 19.8 25.6 18.4 28.6 17z" />
    </svg>
  )
}

// Tiny upward-arrow used inside the empty-state pill.
function ArrowUpIcon() {
  return (
    <svg
      width="12" height="12" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
      className="text-terra"
    >
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </svg>
  )
}

// ── Pure helpers ──────────────────────────────────────────────────────

function formatRelativeDate(iso: string, T: Translations): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const now = Date.now()
  const diffMs = now - d.getTime()
  // Future-dated guard: clock skew or user editing the system clock.
  if (diffMs < 0) return T.sidePanel.relativeDate.now
  const min = Math.floor(diffMs / 60_000)
  if (min < 1) return T.sidePanel.relativeDate.now
  if (min < 60) return interpolate(T.sidePanel.relativeDate.minAgo, { n: min })
  const hr = Math.floor(min / 60)
  if (hr < 24) return interpolate(T.sidePanel.relativeDate.hrAgo, { n: hr })
  const day = Math.floor(hr / 24)
  if (day < 7) return interpolate(T.sidePanel.relativeDate.dayAgo, { n: day })
  return d.toISOString().slice(0, 10)
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url.slice(0, 40)
  }
}

// Returns midnight of the given date in the user's local TZ.
function startOfLocalDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function bucketFor(updatedAt: string): Bucket {
  const d = new Date(updatedAt)
  if (isNaN(d.getTime())) return 'earlier'
  const now = new Date()
  const todayStart = startOfLocalDay(now)
  const itemDayStart = startOfLocalDay(d)
  const dayMs = 24 * 60 * 60 * 1000
  const daysAgo = Math.round((todayStart - itemDayStart) / dayMs)
  if (daysAgo <= 0) return 'today'
  if (daysAgo === 1) return 'yesterday'
  if (daysAgo <= 7) return 'thisWeek'
  if (daysAgo <= 30) return 'thisMonth'
  return 'earlier'
}

function groupByBucket(list: SessionSummary[]): Record<Bucket, SessionSummary[]> {
  const out: Record<Bucket, SessionSummary[]> = {
    today: [], yesterday: [], thisWeek: [], thisMonth: [], earlier: [],
  }
  for (const s of list) {
    out[bucketFor(s.updated_at)].push(s)
  }
  return out
}

function bucketLabel(b: Bucket, T: Translations): string {
  switch (b) {
    case 'today': return T.sidePanel.timeGroup_today
    case 'yesterday': return T.sidePanel.timeGroup_yesterday
    case 'thisWeek': return T.sidePanel.timeGroup_thisWeek
    case 'thisMonth': return T.sidePanel.timeGroup_thisMonth
    case 'earlier': return T.sidePanel.timeGroup_earlier
  }
}
