import type { GalleryFixture } from './types'
import { createElement as h, type ReactNode } from 'react'
import { SessionHistory, type SessionSummary } from '../../side-panel/components/SessionHistory'
import { ExternalLinkIcon } from '../../side-panel/components/icons'
import { useT, interpolate } from '../../shared/i18n'
import type { Translations } from '../../shared/i18n'

// Inlined from SessionHistory.tsx (not exported). Keep in sync if the
// formatting rules change.
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

// Mirrors SearchIcon in SessionHistory.tsx.
function MiniSearchIcon(): ReactNode {
  return h(
    'svg',
    {
      width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none',
      stroke: 'currentColor', strokeWidth: 1.7,
      strokeLinecap: 'round', strokeLinejoin: 'round',
      'aria-hidden': true,
      className: 'absolute left-[1.05rem] top-1/2 -translate-y-1/2 text-ink-300 pointer-events-none',
    },
    h('circle', { cx: 11, cy: 11, r: 7 }),
    h('path', { d: 'm20 20-3.35-3.35' }),
  )
}

// Mirrors TrashIcon in SessionHistory.tsx.
function MiniTrashIcon(): ReactNode {
  return h(
    'svg',
    {
      width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none',
      stroke: 'currentColor', strokeWidth: 1.7,
      strokeLinecap: 'round', strokeLinejoin: 'round',
      'aria-hidden': true,
    },
    h('path', { d: 'M3 6h18' }),
    h('path', { d: 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' }),
    h('path', { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6' }),
    h('path', { d: 'M10 11v6' }),
    h('path', { d: 'M14 11v6' }),
  )
}

const CATEGORY = 'Session history'

// SessionHistory fetches its list via callApi('/v1/sessions') on mount.
// The chrome-mock has no /v1 endpoints, so the real component lands in
// either the initial-loading skeleton (briefly) or the hard-error card
// (once the fetch rejects). Both are useful for design review.
//
// To force the empty / populated / grouped states we'd need to
// monkey-patch callApi at the module level (test-only seam) which is
// out of scope for fixtures. We instead provide static JSX
// recreations that mirror src/side-panel/components/SessionHistory.tsx
// — clearly marked. Keep in sync if SessionHistory's render branches
// change (in particular: SkeletonList, EmptyState, ErrorCard, the
// list/grouping markup, and the search input).

// ── Mock data ─────────────────────────────────────────────────────────

const NOW = Date.now()
function isoMinutesAgo(min: number): string {
  return new Date(NOW - min * 60_000).toISOString()
}
function isoDaysAgo(d: number): string {
  return new Date(NOW - d * 24 * 60 * 60 * 1000).toISOString()
}

const SESSIONS_MANY: SessionSummary[] = [
  { id: 's1',  url: 'https://www.youtube.com/watch?v=a1', title: 'ベイズの定理 入門',          status: 'done', slide_count: 12, has_outline: true,  created_at: isoMinutesAgo(35),  updated_at: isoMinutesAgo(20)  },
  { id: 's2',  url: 'https://www.youtube.com/watch?v=a2', title: '線形代数 — 固有値の幾何',     status: 'done', slide_count: 0,  has_outline: true,  created_at: isoMinutesAgo(180), updated_at: isoMinutesAgo(90)  },
  { id: 's3',  url: 'https://www.coursera.org/lecture/x', title: 'Intro to Machine Learning',  status: 'done', slide_count: 8,  has_outline: true,  created_at: isoDaysAgo(1),     updated_at: isoDaysAgo(1)     },
  { id: 's4',  url: 'https://www.youtube.com/watch?v=a4', title: null,                          status: 'done', slide_count: 0,  has_outline: false, created_at: isoDaysAgo(1),     updated_at: isoDaysAgo(1)     },
  { id: 's5',  url: 'https://www.youtube.com/watch?v=a5', title: 'ナイーブベイズと独立性仮定',  status: 'done', slide_count: 5,  has_outline: false, created_at: isoDaysAgo(3),     updated_at: isoDaysAgo(3)     },
  { id: 's6',  url: 'https://www.youtube.com/watch?v=a6', title: 'MAP 推定 vs 最尤推定',        status: 'done', slide_count: 0,  has_outline: true,  created_at: isoDaysAgo(5),     updated_at: isoDaysAgo(5)     },
  { id: 's7',  url: 'https://lecture.example.com/calc',   title: '微積分 — 連鎖律のおさらい',   status: 'done', slide_count: 14, has_outline: true,  created_at: isoDaysAgo(9),     updated_at: isoDaysAgo(9)     },
  { id: 's8',  url: 'https://www.youtube.com/watch?v=a8', title: 'MCMC の動機づけ',             status: 'done', slide_count: 6,  has_outline: true,  created_at: isoDaysAgo(15),    updated_at: isoDaysAgo(15)    },
  { id: 's9',  url: 'https://www.youtube.com/watch?v=a9', title: '共役事前分布',                status: 'done', slide_count: 0,  has_outline: false, created_at: isoDaysAgo(20),    updated_at: isoDaysAgo(20)    },
  { id: 's10', url: 'https://www.youtube.com/watch?v=a0', title: '統計学基礎 — 期待値と分散',   status: 'done', slide_count: 10, has_outline: true,  created_at: isoDaysAgo(45),    updated_at: isoDaysAgo(45)    },
]

// ── Static recreations — keep in sync with SessionHistory.tsx ────────

function StaticSkeletonList(): ReactNode {
  return h(
    'div',
    { className: 'flex-1 overflow-hidden' },
    h(
      'ul',
      { className: 'divide-y divide-paper-edge' },
      ...[0, 1, 2].map(i =>
        h(
          'li',
          { key: i, className: 'px-3 py-2.5' },
          h('div', { className: 'h-3 w-3/4 bg-ink-200 rounded animate-pulse' }),
          h('div', { className: 'h-2 w-1/2 mt-1.5 bg-ink-200 rounded animate-pulse' }),
          h('div', { className: 'h-2 w-1/3 mt-1 bg-ink-200 rounded animate-pulse' }),
        ),
      ),
    ),
  )
}

function StaticEmptyState(): ReactNode {
  const T = useT()
  return h(
    'div',
    { className: 'px-6 py-10 text-center' },
    h(
      'div',
      { className: 'flex justify-center mb-3 text-terra-soft' },
      // Inline 40px sparkle-document — mirrors DocumentSparkleIcon.
      h(
        'svg',
        {
          width: 40,
          height: 40,
          viewBox: '0 0 40 40',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('path', { d: 'M9 6h14l6 6v22a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z' }),
        h('path', { d: 'M23 6v6h6' }),
        h('path', { d: 'M12 20h12' }),
        h('path', { d: 'M12 25h10' }),
        h('path', { d: 'M12 30h7' }),
        h('path', { d: 'M30 14 31.4 17 34.4 18.4 31.4 19.8 30 22.8 28.6 19.8 25.6 18.4 28.6 17z' }),
      ),
    ),
    h('p', { className: 'text-sm font-medium text-ink-700' }, T.sidePanel.historyEmpty_title),
    h('p', { className: 'text-xs text-ink-500 leading-relaxed mt-1' }, T.sidePanel.historyEmpty_body),
    h(
      'div',
      {
        className:
          'mt-4 inline-flex items-center gap-1.5 bg-terra-tint text-terra-700 px-2 py-0.5 rounded-full text-[11px]',
      },
      h(
        'svg',
        {
          width: 12,
          height: 12,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          className: 'text-terra',
        },
        h('path', { d: 'M12 19V5' }),
        h('path', { d: 'm5 12 7-7 7 7' }),
      ),
      h('span', null, T.sidePanel.inlineHintIcon),
    ),
  )
}

const noop = () => undefined

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

// Mirrors SessionRow in SessionHistory.tsx (button + sibling icons).
function StaticRow({ s, T, flashing }: { s: SessionSummary; T: Translations; flashing?: boolean }): ReactNode {
  const title = s.title?.trim() || T.sidePanel.historyTitle_untitled
  const date = formatRelativeDate(s.updated_at, T)
  const flashClass = flashing ? 'bg-warn-amber/10 ring-1 ring-warn-amber/40' : ''
  return h(
    'li',
    { className: `relative group ${flashClass}` },
    h(
      'button',
      {
        type: 'button',
        onClick: noop,
        className:
          'w-full px-3 py-2.5 pr-16 text-left hover:bg-paper-200 transition flex flex-col gap-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra focus-visible:ring-offset-1',
      },
      h('span', { className: 'text-xs font-medium text-ink-900 line-clamp-2' }, title),
      h(
        'span',
        { className: 'text-[10px] text-ink-500 flex items-center gap-2' },
        h('span', null, date),
        h('span', null, '·'),
        h('span', null, metaFor(s, T)),
      ),
      h(
        'span',
        { className: 'text-[10px] text-ink-300 truncate group-hover:text-ink-900 transition' },
        hostnameOf(s.url),
      ),
    ),
    // Open-source-video icon (right-9, hover-revealed).
    h(
      'button',
      {
        type: 'button',
        onClick: noop,
        title: T.sidePanel.openSourceAria,
        'aria-label': T.sidePanel.openSourceAria,
        className:
          'absolute top-2 right-9 p-1 rounded text-ink-300 hover:text-ink-900 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 max-[360px]:opacity-100 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra focus-visible:ring-offset-1',
      },
      h(ExternalLinkIcon, { size: 14 }),
    ),
    // Trash icon (right-2, hover-revealed).
    h(
      'button',
      {
        type: 'button',
        onClick: noop,
        title: T.sidePanel.deleteAria,
        'aria-label': T.sidePanel.deleteAria,
        className:
          'absolute top-2 right-2 p-1 rounded text-ink-300 hover:text-warn-red opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 max-[360px]:opacity-100 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra focus-visible:ring-offset-1',
      },
      h(MiniTrashIcon),
    ),
  )
}

function StaticPopulatedList({ sessions, withSearch }: { sessions: SessionSummary[]; withSearch: boolean }): ReactNode {
  const T = useT()
  return h(
    'div',
    { className: 'flex-1 overflow-y-auto relative' },
    h(
      'h3',
      {
        className: 'px-3 pt-3 pb-1.5 text-[11px] font-semibold text-ink-500 uppercase tracking-wide',
      },
      interpolate(T.sidePanel.historyHeader, { n: sessions.length }),
    ),
    withSearch
      ? h(
          'div',
          { className: 'relative' },
          h('input', {
            type: 'text',
            placeholder: T.sidePanel.searchPlaceholder,
            'aria-label': T.sidePanel.searchPlaceholder,
            className:
              'w-[calc(100%-1.5rem)] h-7 pl-7 pr-3 py-1.5 mx-3 mt-1 text-xs rounded-md bg-paper-300 border border-transparent focus:bg-paper-100 focus:border-terra focus:ring-2 focus:ring-terra-soft focus:outline-none transition',
            readOnly: true,
          }),
          h(MiniSearchIcon),
        )
      : null,
    h(
      'ul',
      { className: 'divide-y divide-paper-edge' },
      ...sessions.map(s => h(StaticRow, { key: s.id, s, T })),
    ),
  )
}

function StaticGroupedList({ sessions }: { sessions: SessionSummary[] }): ReactNode {
  const T = useT()
  // Hand-bucketed: matches the bucketFor logic in SessionHistory.
  const buckets: Array<{ label: string; items: SessionSummary[] }> = [
    { label: T.sidePanel.timeGroup_today,     items: sessions.slice(0, 2) },
    { label: T.sidePanel.timeGroup_yesterday, items: sessions.slice(2, 4) },
    { label: T.sidePanel.timeGroup_thisWeek,  items: sessions.slice(4, 7) },
    { label: T.sidePanel.timeGroup_thisMonth, items: sessions.slice(7, 9) },
    { label: T.sidePanel.timeGroup_earlier,   items: sessions.slice(9) },
  ]
  return h(
    'div',
    { className: 'flex-1 overflow-y-auto relative' },
    h(
      'h3',
      {
        className: 'px-3 pt-3 pb-1.5 text-[11px] font-semibold text-ink-500 uppercase tracking-wide',
      },
      interpolate(T.sidePanel.historyHeader, { n: sessions.length }),
    ),
    h(
      'div',
      null,
      ...buckets
        .filter(b => b.items.length > 0)
        .map(b =>
          h(
            'div',
            { key: b.label },
            h(
              'div',
              {
                className:
                  'px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-300 bg-paper-200/60',
              },
              b.label,
            ),
            h(
              'ul',
              { className: 'divide-y divide-paper-edge' },
              ...b.items.map(s => h(StaticRow, { key: s.id, s, T })),
            ),
          ),
        ),
    ),
  )
}

export const historyFixtures: GalleryFixture[] = [
  {
    id: 'session-history-loading',
    category: CATEGORY,
    label: 'SessionHistory — initial loading (real component)',
    note:
      'Real component; gallery callApi rejects so this shows the skeleton ' +
      'for ~1 frame before flipping to the error card.',
    height: 360,
    render: () => h(SessionHistory, { onAuthExpired: noop, onView: noop }),
  },
  {
    id: 'session-history-skeleton-static',
    category: CATEGORY,
    label: 'SessionHistory — skeleton (static recreation)',
    note: 'Stable skeleton frame for design review (real component flickers past it).',
    height: 200,
    render: () => h(StaticSkeletonList),
  },
  {
    id: 'session-history-empty-static',
    category: CATEGORY,
    label: 'SessionHistory — empty state (static recreation)',
    note: 'Mirrors EmptyState from src/side-panel/components/SessionHistory.tsx.',
    height: 320,
    render: () => h(StaticEmptyState),
  },
  {
    id: 'session-history-grouped-static',
    category: CATEGORY,
    label: 'SessionHistory — many sessions, time-bucketed (static)',
    note: '10 sessions across 5 buckets; mirrors the bucket headers + flat row layout.',
    height: 720,
    render: () => h(StaticGroupedList, { sessions: SESSIONS_MANY }),
  },
  {
    id: 'session-history-search-static',
    category: CATEGORY,
    label: 'SessionHistory — search bar visible (static, 8+ sessions)',
    note: 'Search input shown when sessions.length ≥ 8. Static recreation.',
    height: 720,
    render: () => h(StaticPopulatedList, { sessions: SESSIONS_MANY, withSearch: true }),
  },
  {
    id: 'session-history-search-empty',
    category: CATEGORY,
    label: 'SessionHistory — search returned no results',
    note: 'Mirrors the "search empty" branch (visibleSessions.length === 0 && query !== "").',
    height: 240,
    render: () => {
      const T = useT()
      return h(
        'div',
        { className: 'flex-1 overflow-y-auto relative' },
        h(
          'div',
          { className: 'relative' },
          h('input', {
            type: 'text',
            value: 'プログレッシブWeb',
            readOnly: true,
            placeholder: T.sidePanel.searchPlaceholder,
            'aria-label': T.sidePanel.searchPlaceholder,
            className:
              'w-[calc(100%-1.5rem)] h-7 pl-7 pr-3 py-1.5 mx-3 mt-1 text-xs rounded-md bg-paper-100 border border-terra focus:ring-2 focus:ring-terra-soft focus:outline-none transition',
          }),
          h(MiniSearchIcon),
        ),
        h(
          'div',
          { className: 'text-xs text-ink-500 py-8 text-center px-3' },
          h('p', null, interpolate(T.sidePanel.searchEmpty, { q: 'プログレッシブWeb' })),
          h(
            'button',
            {
              type: 'button',
              onClick: noop,
              className:
                'mt-2 text-xs text-ink-900 hover:text-terra-700 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra focus-visible:ring-offset-1 rounded',
            },
            T.sidePanel.searchClear,
          ),
        ),
      )
    },
  },
  {
    id: 'session-history-confirm-delete',
    category: CATEGORY,
    label: 'SessionHistory — inline delete confirm',
    note: 'Mirrors ConfirmStrip in SessionHistory.tsx (replaces meta line on the row).',
    height: 220,
    render: () => {
      const T = useT()
      const s = SESSIONS_MANY[0]
      return h(
        'ul',
        { className: 'divide-y divide-paper-edge' },
        // Sibling row above for visual context.
        h(StaticRow, { s: SESSIONS_MANY[1], T }),
        // The confirming row: title + ConfirmStrip in place of meta.
        h(
          'li',
          { className: 'relative group' },
          h(
            'button',
            {
              type: 'button',
              onClick: noop,
              className:
                'w-full px-3 py-2.5 pr-3 text-left flex flex-col gap-0.5',
            },
            h(
              'span',
              { className: 'text-xs font-medium text-ink-900 line-clamp-2' },
              s.title?.trim() || T.sidePanel.historyTitle_untitled,
            ),
          ),
          h(
            'div',
            {
              className:
                'bg-warn-red/5 border-l-2 border-warn-red px-3 py-2 mx-0 mt-0 flex items-center gap-2',
              role: 'alertdialog',
              'aria-label': T.sidePanel.deleteConfirmBody,
            },
            h(
              'p',
              { className: 'flex-1 text-[11px] text-warn-red leading-snug' },
              T.sidePanel.deleteConfirmBody,
            ),
            h(
              'button',
              {
                type: 'button',
                onClick: noop,
                className:
                  'bg-paper-100 border border-paper-edge text-ink-700 text-[11px] px-2 py-0.5 rounded hover:bg-paper-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra focus-visible:ring-offset-1',
              },
              T.common.cancel,
            ),
            h(
              'button',
              {
                type: 'button',
                onClick: noop,
                className:
                  'bg-warn-red text-white text-[11px] px-2 py-0.5 rounded hover:bg-warn-red focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warn-red/40 focus-visible:ring-offset-1',
              },
              T.sidePanel.deleteConfirm,
            ),
          ),
        ),
      )
    },
  },
  {
    id: 'session-history-flash-failure',
    category: CATEGORY,
    label: 'SessionHistory — row flash after failed delete',
    note: 'flashClass = bg-warn-amber/10 ring-1 ring-warn-amber/40 (transient on the row).',
    height: 110,
    render: () => {
      const T = useT()
      return h(
        'ul',
        { className: 'divide-y divide-paper-edge' },
        h(StaticRow, { s: SESSIONS_MANY[0], T, flashing: true }),
      )
    },
  },
  {
    id: 'session-history-error-card',
    category: CATEGORY,
    label: 'SessionHistory — fetch error (retryable)',
    note: 'Mirrors ErrorCard with retriesUsed < FAILURE_GIVE_UP.',
    height: 200,
    render: () => {
      const T = useT()
      return h(
        'div',
        {
          className:
            'mx-3 mt-3 p-3 rounded-md bg-warn-red/5 border border-warn-red/30 flex flex-col gap-2',
        },
        h(
          'div',
          null,
          h('p', { className: 'text-xs text-warn-red' }, T.sidePanel.historyFetchFailed),
          h(
            'p',
            { className: 'text-[10px] text-warn-red mt-1 font-mono break-all' },
            'HTTP 503 — upstream timeout',
          ),
        ),
        h(
          'div',
          { className: 'flex justify-end' },
          h(
            'button',
            {
              type: 'button',
              onClick: noop,
              className:
                'text-xs px-3 py-1 rounded bg-paper-100 border border-warn-red/40 text-warn-red hover:bg-warn-red/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warn-red/40 focus-visible:ring-offset-1',
            },
            T.common.retry,
          ),
        ),
      )
    },
  },
  {
    id: 'session-history-error-card-exhausted',
    category: CATEGORY,
    label: 'SessionHistory — fetch error (give-up, no retry button)',
    note: 'Mirrors ErrorCard with retriesUsed ≥ FAILURE_GIVE_UP.',
    height: 140,
    render: () => {
      const T = useT()
      return h(
        'div',
        {
          className:
            'mx-3 mt-3 p-3 rounded-md bg-warn-red/5 border border-warn-red/30 flex flex-col gap-2',
        },
        h(
          'div',
          null,
          h(
            'p',
            { className: 'text-xs text-warn-red' },
            T.sidePanel.historyFetchFailedAgain,
          ),
          h(
            'p',
            { className: 'text-[10px] text-warn-red mt-1 font-mono break-all' },
            'HTTP 503 — upstream timeout',
          ),
        ),
      )
    },
  },
]
