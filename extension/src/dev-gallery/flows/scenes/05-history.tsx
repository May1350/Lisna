import { useT, interpolate } from '../../../shared/i18n'
import type { Translations } from '../../../shared/i18n'
import { OutlineView } from '../../../side-panel/components/OutlineView'
import type { SessionSummary } from '../../../side-panel/components/SessionHistory'
import { BackIcon, ExternalLinkIcon } from '../../../side-panel/components/icons'
import { AppShell } from './_shared'
import { FREE_USER, OUTLINE_LONG_8, SLIDES_FEW } from '../../fixtures/_mock-data'
import type { FlowGraph } from '../types'

// =============================================================================
// History / Notes flow — side-panel surface (360×640).
// User opens the side panel, scans past sessions, searches, deletes a row,
// or drills into one to view its outline. Alt path: load failure.
//
// The fixture file (src/dev-gallery/fixtures/10-history.ts) contains static
// JSX recreations for the same SessionHistory branches we need here, but
// those helpers are not exported. To avoid refactoring fixture-side code,
// we mirror the markup inline below — keep these in sync with the
// originals there + src/side-panel/components/SessionHistory.tsx and
// src/side-panel/components/NotesViewer.tsx.
// =============================================================================

const noop = () => undefined

// ── Mock data — matches SESSIONS_MANY in fixtures/10-history.ts ──────
const NOW = Date.now()
const isoMinutesAgo = (min: number) => new Date(NOW - min * 60_000).toISOString()
const isoDaysAgo = (d: number) => new Date(NOW - d * 24 * 60 * 60 * 1000).toISOString()

const SESSIONS_MANY: SessionSummary[] = [
  { id: 's1',  url: 'https://www.youtube.com/watch?v=a1', title: 'ベイズの定理 入門',          status: 'done', slide_count: 12, has_outline: true,  created_at: isoMinutesAgo(35),  updated_at: isoMinutesAgo(20)  },
  { id: 's2',  url: 'https://www.youtube.com/watch?v=a2', title: '線形代数 — 固有値の幾何',     status: 'done', slide_count: 0,  has_outline: true,  created_at: isoMinutesAgo(180), updated_at: isoMinutesAgo(90)  },
  { id: 's3',  url: 'https://www.coursera.org/lecture/x', title: 'Intro to Machine Learning',  status: 'done', slide_count: 8,  has_outline: true,  created_at: isoDaysAgo(1),     updated_at: isoDaysAgo(1)     },
  { id: 's4',  url: 'https://www.youtube.com/watch?v=a4', title: null,                          status: 'done', slide_count: 0,  has_outline: false, created_at: isoDaysAgo(1),     updated_at: isoDaysAgo(1)     },
  { id: 's5',  url: 'https://www.youtube.com/watch?v=a5', title: 'ナイーブベイズと独立性仮定',  status: 'done', slide_count: 5,  has_outline: false, created_at: isoDaysAgo(3),     updated_at: isoDaysAgo(3)     },
  { id: 's6',  url: 'https://www.youtube.com/watch?v=a6', title: 'MAP 推定 vs 最尤推定',        status: 'done', slide_count: 0,  has_outline: true,  created_at: isoDaysAgo(5),     updated_at: isoDaysAgo(5)     },
  { id: 's7',  url: 'https://lecture.example.com/calc',   title: '微積分 — 連鎖律のおさらい',   status: 'done', slide_count: 14, has_outline: true,  created_at: isoDaysAgo(9),     updated_at: isoDaysAgo(9)     },
  { id: 's8',  url: 'https://www.youtube.com/watch?v=a8', title: 'MCMC の動機づけ',             status: 'done', slide_count: 6,  has_outline: true,  created_at: isoDaysAgo(15),    updated_at: isoDaysAgo(15)    },
]

// ── Inline helpers mirroring SessionHistory.tsx internals ────────────

function formatRelativeDate(iso: string, T: Translations): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const diffMs = Date.now() - d.getTime()
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

function metaFor(s: SessionSummary, T: Translations): string {
  if (s.has_outline) {
    return s.slide_count > 0
      ? interpolate(T.sidePanel.historyMeta_outline_withSlides, { n: s.slide_count })
      : T.sidePanel.historyMeta_withOutline
  }
  return s.slide_count > 0
    ? interpolate(T.sidePanel.historyMeta_slidesOnly, { n: s.slide_count })
    : T.sidePanel.historyMeta_recordOnly
}

function MiniSearchIcon() {
  return (
    <svg
      width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.7}
      strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
      className="absolute left-[1.05rem] top-1/2 -translate-y-1/2 text-ink-300 pointer-events-none"
    >
      <circle cx={11} cy={11} r={7} />
      <path d="m20 20-3.35-3.35" />
    </svg>
  )
}

function MiniTrashIcon() {
  return (
    <svg
      width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.7}
      strokeLinecap="round" strokeLinejoin="round"
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

function StaticRow({ s, T }: { s: SessionSummary; T: Translations }) {
  const title = s.title?.trim() || T.sidePanel.historyTitle_untitled
  const date = formatRelativeDate(s.updated_at, T)
  return (
    <li className="relative group">
      <button
        type="button"
        onClick={noop}
        className="w-full px-3 py-2.5 pr-16 text-left hover:bg-paper-200 transition flex flex-col gap-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra focus-visible:ring-offset-1"
      >
        <span className="text-xs font-medium text-ink-900 line-clamp-2">{title}</span>
        <span className="text-[10px] text-ink-500 flex items-center gap-2">
          <span>{date}</span>
          <span>·</span>
          <span>{metaFor(s, T)}</span>
        </span>
        <span className="text-[10px] text-ink-300 truncate group-hover:text-ink-900 transition">
          {hostnameOf(s.url)}
        </span>
      </button>
      <button
        type="button"
        onClick={noop}
        title={T.sidePanel.openSourceAria}
        aria-label={T.sidePanel.openSourceAria}
        className="absolute top-2 right-9 p-1 rounded text-ink-300 hover:text-ink-900 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 max-[360px]:opacity-100 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra focus-visible:ring-offset-1"
      >
        <ExternalLinkIcon size={14} />
      </button>
      <button
        type="button"
        onClick={noop}
        title={T.sidePanel.deleteAria}
        aria-label={T.sidePanel.deleteAria}
        className="absolute top-2 right-2 p-1 rounded text-ink-300 hover:text-warn-red opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 max-[360px]:opacity-100 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra focus-visible:ring-offset-1"
      >
        <MiniTrashIcon />
      </button>
    </li>
  )
}

// Time-bucketed list (default landing view).
function GroupedList({ sessions }: { sessions: SessionSummary[] }) {
  const T = useT()
  const buckets: Array<{ label: string; items: SessionSummary[] }> = [
    { label: T.sidePanel.timeGroup_today,     items: sessions.slice(0, 2) },
    { label: T.sidePanel.timeGroup_yesterday, items: sessions.slice(2, 4) },
    { label: T.sidePanel.timeGroup_thisWeek,  items: sessions.slice(4, 7) },
    { label: T.sidePanel.timeGroup_earlier,   items: sessions.slice(7) },
  ]
  return (
    <div className="flex-1 overflow-y-auto relative">
      <h3 className="px-3 pt-3 pb-1.5 text-[11px] font-semibold text-ink-500 uppercase tracking-wide">
        {interpolate(T.sidePanel.historyHeader, { n: sessions.length })}
      </h3>
      <div>
        {buckets.filter(b => b.items.length > 0).map(b => (
          <div key={b.label}>
            <div className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-300 bg-paper-200/60">
              {b.label}
            </div>
            <ul className="divide-y divide-paper-edge">
              {b.items.map(s => <StaticRow key={s.id} s={s} T={T} />)}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}

// Flat list with prefilled search input (filtering simulated by slicing).
function SearchActiveList({ sessions, query }: { sessions: SessionSummary[]; query: string }) {
  const T = useT()
  const filtered = sessions.filter(s =>
    (s.title ?? '').toLowerCase().includes(query.toLowerCase()),
  )
  return (
    <div className="flex-1 overflow-y-auto relative">
      <h3 className="px-3 pt-3 pb-1.5 text-[11px] font-semibold text-ink-500 uppercase tracking-wide">
        {interpolate(T.sidePanel.historyHeader, { n: sessions.length })}
      </h3>
      <div className="relative">
        <input
          type="text"
          value={query}
          readOnly
          placeholder={T.sidePanel.searchPlaceholder}
          aria-label={T.sidePanel.searchPlaceholder}
          className="w-[calc(100%-1.5rem)] h-7 pl-7 pr-3 py-1.5 mx-3 mt-1 text-xs rounded-md bg-paper-100 border border-terra focus:ring-2 focus:ring-terra-soft focus:outline-none transition"
        />
        <MiniSearchIcon />
      </div>
      <ul className="divide-y divide-paper-edge">
        {filtered.map(s => <StaticRow key={s.id} s={s} T={T} />)}
      </ul>
    </div>
  )
}

function SearchEmpty({ query }: { query: string }) {
  const T = useT()
  return (
    <div className="flex-1 overflow-y-auto relative">
      <div className="relative">
        <input
          type="text"
          value={query}
          readOnly
          placeholder={T.sidePanel.searchPlaceholder}
          aria-label={T.sidePanel.searchPlaceholder}
          className="w-[calc(100%-1.5rem)] h-7 pl-7 pr-3 py-1.5 mx-3 mt-1 text-xs rounded-md bg-paper-100 border border-terra focus:ring-2 focus:ring-terra-soft focus:outline-none transition"
        />
        <MiniSearchIcon />
      </div>
      <div className="text-xs text-ink-500 py-8 text-center px-3">
        <p>{interpolate(T.sidePanel.searchEmpty, { q: query })}</p>
        <button
          type="button"
          onClick={noop}
          className="mt-2 text-xs text-ink-900 hover:text-terra-700 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra focus-visible:ring-offset-1 rounded"
        >
          {T.sidePanel.searchClear}
        </button>
      </div>
    </div>
  )
}

function ConfirmDeleteList({ sessions }: { sessions: SessionSummary[] }) {
  const T = useT()
  const target = sessions[0]
  return (
    <div className="flex-1 overflow-y-auto relative">
      <h3 className="px-3 pt-3 pb-1.5 text-[11px] font-semibold text-ink-500 uppercase tracking-wide">
        {interpolate(T.sidePanel.historyHeader, { n: sessions.length })}
      </h3>
      <ul className="divide-y divide-paper-edge">
        {/* Sibling row above for visual context. */}
        <StaticRow s={sessions[1]} T={T} />
        {/* The confirming row: title + ConfirmStrip in place of meta. */}
        <li className="relative group">
          <button
            type="button"
            onClick={noop}
            className="w-full px-3 py-2.5 pr-3 text-left flex flex-col gap-0.5"
          >
            <span className="text-xs font-medium text-ink-900 line-clamp-2">
              {target.title?.trim() || T.sidePanel.historyTitle_untitled}
            </span>
          </button>
          <div
            className="bg-warn-red/5 border-l-2 border-warn-red px-3 py-2 mx-0 mt-0 flex items-center gap-2"
            role="alertdialog"
            aria-label={T.sidePanel.deleteConfirmBody}
          >
            <p className="flex-1 text-[11px] text-warn-red leading-snug">
              {T.sidePanel.deleteConfirmBody}
            </p>
            <button
              type="button"
              onClick={noop}
              className="bg-paper-100 border border-paper-edge text-ink-700 text-[11px] px-2 py-0.5 rounded hover:bg-paper-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra focus-visible:ring-offset-1"
            >
              {T.common.cancel}
            </button>
            <button
              type="button"
              onClick={noop}
              className="bg-warn-red text-white text-[11px] px-2 py-0.5 rounded hover:bg-warn-red focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warn-red/40 focus-visible:ring-offset-1"
            >
              {T.sidePanel.deleteConfirm}
            </button>
          </div>
        </li>
        {sessions.slice(2, 4).map(s => <StaticRow key={s.id} s={s} T={T} />)}
      </ul>
    </div>
  )
}

function ErrorCard() {
  const T = useT()
  return (
    <div className="mx-3 mt-3 p-3 rounded-md bg-warn-red/5 border border-warn-red/30 flex flex-col gap-2">
      <div>
        <p className="text-xs text-warn-red">{T.sidePanel.historyFetchFailed}</p>
        <p className="text-[10px] text-warn-red mt-1 font-mono break-all">
          HTTP 503 — upstream timeout
        </p>
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={noop}
          className="text-xs px-3 py-1 rounded bg-paper-100 border border-warn-red/40 text-warn-red hover:bg-warn-red/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warn-red/40 focus-visible:ring-offset-1"
        >
          {T.common.retry}
        </button>
      </div>
    </div>
  )
}

// ── NotesViewer mocks (mirrors fixtures/05-notes-export.ts MockShell + MockHeader + MockEmptyBlock) ──

function NotesHeader({ title }: { title: string }) {
  const T = useT()
  const backLabel = T.sidePanel.notesViewer_back
  const openLabel = T.sidePanel.notesViewer_openSource
  return (
    <div className="lisna-sticky-toolbar">
      <button
        type="button"
        onClick={noop}
        title={backLabel}
        aria-label={backLabel}
        className="flex items-center gap-1 px-2 py-1 text-xs text-ink-700 hover:text-ink-900 rounded hover:bg-paper-300 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra"
      >
        <BackIcon size={14} />
        <span>{backLabel}</span>
      </button>
      <span className="flex-1 text-xs font-medium text-ink-900 truncate" title={title}>{title}</span>
      <button
        type="button"
        onClick={noop}
        title={openLabel}
        aria-label={openLabel}
        className="p-1 rounded text-ink-300 hover:text-ink-900 hover:bg-paper-300 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra"
      >
        <ExternalLinkIcon size={14} />
      </button>
    </div>
  )
}

function NotesEmpty({ copy }: { copy: string }) {
  const T = useT()
  return (
    <div className="flex flex-col items-center justify-center text-center px-6 py-12 gap-3">
      <p className="text-xs text-ink-700">{copy}</p>
      <button
        type="button"
        onClick={noop}
        className="text-xs text-ink-900 hover:text-terra-700 underline-offset-2 hover:underline"
      >
        {T.sidePanel.notesViewer_back}
      </button>
    </div>
  )
}

function NotesShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col h-full bg-paper-100">
      <NotesHeader title={title} />
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  )
}

function NotesNotFoundScene() {
  const T = useT()
  return (
    <NotesShell title="(無題のノート)">
      <NotesEmpty copy={T.sidePanel.notesViewer_notFound} />
    </NotesShell>
  )
}

// =============================================================================

// Layout intent (side-panel surface = 360×640 → wider gutter for hub layout):
//   list-loaded sits at center; satellites radiate clockwise. y=0 row is the
//   top branch axis; y=ROW is the hub row; y=ROW*2 is the failure row below.
const COL = 460
const ROW = 800

export const historyFlow: FlowGraph = {
  id: 'history',
  label: 'History / Notes',
  caption: 'Side-panel mode — list past sessions → view notes → search → delete; alt: load failure',
  surface: 'side-panel',
  positions: {
    'list-loaded':     { x: COL * 1, y: ROW * 1 }, // hub (center)
    'search-active':   { x: COL * 0, y: ROW * 1 }, // left of hub
    'search-empty':    { x: COL * 0, y: 0       }, // top-left
    'confirm-delete':  { x: COL * 1, y: 0       }, // above hub
    'notes-loaded':    { x: COL * 2, y: ROW * 1 }, // right of hub
    'notes-not-found': { x: COL * 2, y: 0       }, // top-right
    'error-card':      { x: COL * 1, y: ROW * 2 }, // below hub
  },
  scenes: [
    {
      id: 'list-loaded',
      label: 'SessionHistory — populated (hub)',
      caption: 'Side-panel default view — past sessions ordered by recency.',
      render: () => (
        <AppShell user={FREE_USER} isEmbed={false} liveRemainingSecs={null}>
          <GroupedList sessions={SESSIONS_MANY} />
        </AppShell>
      ),
    },
    {
      id: 'search-active',
      label: 'SessionHistory — search active',
      caption: 'Search filters list as user types.',
      render: () => (
        <AppShell user={FREE_USER} isEmbed={false} liveRemainingSecs={null}>
          <SearchActiveList sessions={SESSIONS_MANY} query="ベイズ" />
        </AppShell>
      ),
    },
    {
      id: 'search-empty',
      label: 'SessionHistory — search empty',
      caption: 'Search yielded no matches.',
      tags: ['transient'],
      render: () => (
        <AppShell user={FREE_USER} isEmbed={false} liveRemainingSecs={null}>
          <SearchEmpty query="プログレッシブWeb" />
        </AppShell>
      ),
    },
    {
      id: 'confirm-delete',
      label: 'SessionHistory — confirm delete',
      caption: 'Per-row inline confirm before destructive delete.',
      tags: ['modal'],
      render: () => (
        <AppShell user={FREE_USER} isEmbed={false} liveRemainingSecs={null}>
          <ConfirmDeleteList sessions={SESSIONS_MANY} />
        </AppShell>
      ),
    },
    {
      id: 'notes-loaded',
      label: 'NotesViewer — outline loaded',
      caption: 'Selected session — full outline rendered, scrollable.',
      render: () => (
        <AppShell user={FREE_USER} isEmbed={false} liveRemainingSecs={null}>
          <NotesShell title={OUTLINE_LONG_8.title}>
            <OutlineView
              outline={OUTLINE_LONG_8}
              slides={SLIDES_FEW}
              onJump={noop}
              displayTitle={OUTLINE_LONG_8.title}
            />
          </NotesShell>
        </AppShell>
      ),
    },
    {
      id: 'notes-not-found',
      label: 'NotesViewer — not found',
      caption: 'Selected session has no outline yet — empty state with back button.',
      tags: ['error'],
      render: () => (
        <AppShell user={FREE_USER} isEmbed={false} liveRemainingSecs={null}>
          <NotesNotFoundScene />
        </AppShell>
      ),
    },
    {
      id: 'error-card',
      label: 'SessionHistory — fetch error',
      caption: 'Network error fetching session list — retryable.',
      tags: ['error'],
      render: () => (
        <AppShell user={FREE_USER} isEmbed={false} liveRemainingSecs={null}>
          <ErrorCard />
        </AppShell>
      ),
    },
  ],
  edges: [
    // Hub ↔ search (left side, bidirectional via left/right handles)
    { from: 'list-loaded', to: 'search-active', label: 'type query', sourceHandle: 'left', targetHandle: 'right' },
    { from: 'search-active', to: 'list-loaded', label: 'clear', dashed: true, sourceHandle: 'right', targetHandle: 'left' },
    // Search continues filtering with no results (vertical jump up to top-left)
    { from: 'search-active', to: 'search-empty', label: 'no match', sourceHandle: 'top', targetHandle: 'bottom' },
    { from: 'search-empty', to: 'search-active', label: 'back', dashed: true, sourceHandle: 'bottom', targetHandle: 'top' },
    // Hub ↔ confirm-delete (above hub)
    { from: 'list-loaded', to: 'confirm-delete', label: '🗑 click', sourceHandle: 'top', targetHandle: 'bottom' },
    { from: 'confirm-delete', to: 'list-loaded', label: 'cancel', dashed: true, sourceHandle: 'bottom', targetHandle: 'top' },
    // Hub ↔ notes-loaded (right of hub)
    { from: 'list-loaded', to: 'notes-loaded', label: 'row click', sourceHandle: 'right', targetHandle: 'left' },
    { from: 'notes-loaded', to: 'list-loaded', label: 'back', dashed: true, sourceHandle: 'left', targetHandle: 'right' },
    // Notes-loaded → not-found (vertical jump up to top-right)
    { from: 'notes-loaded', to: 'notes-not-found', label: 'no outline', dashed: true, sourceHandle: 'top', targetHandle: 'bottom' },
    // Hub → error-card (below hub)
    { from: 'list-loaded', to: 'error-card', label: 'fetch fails', dashed: true, sourceHandle: 'bottom', targetHandle: 'top' },
  ],
  boundaryLinks: [
    { fromScene: 'list-loaded', toFlowId: 'recording', toSceneId: 'post-session', label: 'open history', direction: 'in' },
  ],
}
