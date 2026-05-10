import type { GalleryFixture } from './types'
import { createElement as h } from 'react'
import { NotesViewer } from '../../side-panel/components/NotesViewer'
import { OutlineView } from '../../side-panel/components/OutlineView'
import { ExportMenu } from '../../side-panel/components/ExportMenu'
import { BackIcon, ExternalLinkIcon } from '../../side-panel/components/icons'
import type { SessionSummary } from '../../side-panel/components/SessionHistory'
import { OUTLINE_LONG_8, SLIDES_FEW, SLIDES_MANY } from './_mock-data'
import { t } from '../../shared/i18n'

// Category 5 — Notes viewer + Export.
//
// NotesViewer fetches via callApi(...) on mount. Stubbing the imported
// function from inside a fixture would require monkey-patching the
// already-imported module — too fragile. Approach taken:
//   - One fixture renders the real NotesViewer; without a backend the
//     fetch fails fast, exercising the *failed* state end-to-end.
//   - The other visual states (loading skeleton, not_found, ok) are
//     recreated as plain JSX that mirrors NotesViewer's internal
//     layout, so designers can review every surface on one page.
// ExportMenu's `open` and `busy` states are internal React state with
// no prop hooks — fixtures render the closed state and a "click ▾"
// note for the open / busy variants.

const noop = () => undefined

const SESSION_DEAD: SessionSummary = {
  id: 'sess_dev_dead',
  url: 'https://example.invalid/lecture/bayes',
  title: 'ベイズ統計フルセッション',
  status: 'completed',
  slide_count: 12,
  has_outline: true,
  created_at: new Date(Date.now() - 86_400_000).toISOString(),
  updated_at: new Date(Date.now() - 60_000).toISOString(),
}

// ── Static recreations of NotesViewer's inner surfaces. Kept verbatim
//    with NotesViewer.tsx so the gallery stays a true visual reference.

function MockHeader({ title }: { title: string }) {
  const T = t()
  const backLabel = T.sidePanel.notesViewer_back
  const openLabel = T.sidePanel.notesViewer_openSource
  return h(
    'div',
    {
      className:
        'sticky top-0 z-10 flex items-center gap-2 px-3 py-2 bg-paper-100/95 backdrop-blur border-b border-paper-edge',
    },
    h(
      'button',
      {
        type: 'button',
        onClick: noop,
        title: backLabel,
        'aria-label': backLabel,
        className:
          'flex items-center gap-1 px-2 py-1 text-xs text-ink-700 hover:text-ink-900 rounded hover:bg-paper-300 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra',
      },
      h(BackIcon, { size: 14 }),
      h('span', null, backLabel),
    ),
    h(
      'span',
      { className: 'flex-1 text-xs font-medium text-ink-900 truncate', title },
      title,
    ),
    h(
      'button',
      {
        type: 'button',
        onClick: noop,
        title: openLabel,
        'aria-label': openLabel,
        className:
          'p-1 rounded text-ink-300 hover:text-ink-900 hover:bg-paper-300 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra',
      },
      h(ExternalLinkIcon, { size: 14 }),
    ),
  )
}

function MockEmptyBlock({ copy }: { copy: string }) {
  const T = t()
  return h(
    'div',
    {
      className:
        'flex flex-col items-center justify-center text-center px-6 py-12 gap-3',
    },
    h('p', { className: 'text-xs text-ink-700' }, copy),
    h(
      'button',
      {
        type: 'button',
        onClick: noop,
        className:
          'text-xs text-ink-900 hover:text-terra-700 underline-offset-2 hover:underline',
      },
      T.sidePanel.notesViewer_back,
    ),
  )
}

function MockLoadingBlock() {
  const T = t()
  return h(
    'div',
    { className: 'px-4 py-6' },
    h('div', { className: 'text-xs text-ink-500 mb-3' }, T.sidePanel.notesViewer_loading),
    h(
      'div',
      { className: 'space-y-2' },
      h('div', { className: 'h-3 w-2/3 bg-ink-200 rounded animate-pulse' }),
      h('div', { className: 'h-3 w-5/6 bg-ink-200 rounded animate-pulse' }),
      h('div', { className: 'h-3 w-1/2 bg-ink-200 rounded animate-pulse' }),
      h('div', { className: 'h-3 w-3/4 bg-ink-200 rounded animate-pulse' }),
      h('div', { className: 'h-3 w-2/3 bg-ink-200 rounded animate-pulse' }),
    ),
  )
}

function MockShell({ title, body }: { title: string; body: ReturnType<typeof h> }) {
  // Real component uses h-screen; the gallery Frame already constrains
  // the viewport, so we use h-full here to fill the frame exactly.
  return h(
    'div',
    { className: 'flex flex-col h-full bg-paper-100' },
    h(MockHeader, { title }),
    h('div', { className: 'flex-1 overflow-y-auto' }, body),
  )
}

export const notesExportFixtures: GalleryFixture[] = [
  // ── NotesViewer ────────────────────────────────────────────────
  {
    id: 'notes-viewer-loading-static',
    category: 'Notes / Export',
    label: 'NotesViewer — loading (static recreation)',
    note: 'Re-renders NotesViewer\'s loading skeleton without the API call.',
    height: 520,
    render: () =>
      h(MockShell, {
        title: SESSION_DEAD.title ?? '(無題のノート)',
        body: h(MockLoadingBlock),
      }),
  },
  {
    id: 'notes-viewer-loaded-ok',
    category: 'Notes / Export',
    label: 'NotesViewer — loaded with outline',
    note: 'Static recreation: header + OutlineView (real component) with OUTLINE_LONG_8.',
    height: 600,
    render: () =>
      h(MockShell, {
        title: OUTLINE_LONG_8.title,
        body: h(OutlineView, {
          outline: OUTLINE_LONG_8,
          slides: SLIDES_FEW,
          onJump: noop,
          displayTitle: OUTLINE_LONG_8.title,
        }),
      }),
  },
  {
    id: 'notes-viewer-not-found',
    category: 'Notes / Export',
    label: 'NotesViewer — not found',
    note: 'Static recreation of the not_found EmptyBlock.',
    height: 360,
    render: () => {
      const T = t()
      return h(MockShell, {
        title: '(無題のノート)',
        body: h(MockEmptyBlock, { copy: T.sidePanel.notesViewer_notFound }),
      })
    },
  },
  {
    id: 'notes-viewer-load-failed',
    category: 'Notes / Export',
    label: 'NotesViewer — generic error',
    note: 'Static recreation of the failed EmptyBlock.',
    height: 360,
    render: () => {
      const T = t()
      return h(MockShell, {
        title: '(無題のノート)',
        body: h(MockEmptyBlock, { copy: T.sidePanel.notesViewer_loadFailed }),
      })
    },
  },
  {
    id: 'notes-viewer-live-failed',
    category: 'Notes / Export',
    label: 'NotesViewer — live (no backend → failed)',
    note: 'Real NotesViewer mounted; with no backend the fetch errors and the failed surface renders.',
    height: 520,
    render: () =>
      h(NotesViewer, {
        session: SESSION_DEAD,
        onBack: noop,
        onAuthExpired: noop,
      }),
  },

  // ── ExportMenu ─────────────────────────────────────────────────
  {
    id: 'export-menu-with-slides',
    category: 'Notes / Export',
    label: 'ExportMenu — closed (with slides)',
    note: 'Default state. Click ▾ to open the dropdown (internal state).',
    height: 96,
    render: () =>
      h(
        'div',
        { className: 'p-3 bg-paper-100' },
        h(ExportMenu, {
          sourceUrl: 'https://www.youtube.com/watch?v=dev',
          title: OUTLINE_LONG_8.title,
          slides: SLIDES_MANY,
          sessionId: 'sess_dev_pro',
        }),
      ),
  },
  {
    id: 'export-menu-no-slides',
    category: 'Notes / Export',
    label: 'ExportMenu — closed, no slides',
    note: '.zip auto-disabled; .html becomes the default primary action.',
    height: 96,
    render: () =>
      h(
        'div',
        { className: 'p-3 bg-paper-100' },
        h(ExportMenu, {
          sourceUrl: 'https://www.youtube.com/watch?v=dev',
          title: OUTLINE_LONG_8.title,
          slides: [],
          sessionId: 'sess_dev_no_slides',
        }),
      ),
  },
  {
    id: 'export-menu-open-hint',
    category: 'Notes / Export',
    label: 'ExportMenu — open (interact)',
    note: 'Click ▾ to expand the format-picker popover; busy state appears for ~1.5 s after clicking the primary button.',
    height: 280,
    render: () =>
      h(
        'div',
        { className: 'p-3 bg-paper-100 h-full flex items-end' },
        h(ExportMenu, {
          sourceUrl: 'https://www.youtube.com/watch?v=dev',
          title: OUTLINE_LONG_8.title,
          slides: SLIDES_FEW,
          sessionId: 'sess_dev_open',
        }),
      ),
  },
]
