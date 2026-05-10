import type { GalleryFixture } from './types'
import { createElement as h } from 'react'
import { OutlineView } from '../../side-panel/components/OutlineView'
import {
  OUTLINE_SHORT_2,
  OUTLINE_LONG_8,
  SLIDES_FEW,
  SLIDES_MANY,
} from './_mock-data'

// Category 4 — Outline / curated lecture notes.
// One fixture per OutlineView visual state. Width overrides only used
// where the SectionRail's narrow/wide threshold (420 px) is the point.

const noop = () => undefined

export const outlineFixtures: GalleryFixture[] = [
  {
    id: 'outline-empty',
    category: 'Outline',
    label: 'OutlineView — null outline (processing)',
    note: 'outline === null → empty-hint placeholder.',
    height: 240,
    render: () => h(OutlineView, { outline: null, onJump: noop }),
  },
  {
    id: 'outline-short-no-slides',
    category: 'Outline',
    label: 'Short outline (2 sections), no slides',
    note: 'Rail visible at section count >= 2 threshold.',
    render: () => h(OutlineView, { outline: OUTLINE_SHORT_2, onJump: noop }),
  },
  {
    id: 'outline-short-with-slides',
    category: 'Outline',
    label: 'Short outline + a few slides',
    render: () =>
      h(OutlineView, {
        outline: OUTLINE_SHORT_2,
        slides: SLIDES_FEW,
        onJump: noop,
      }),
  },
  {
    id: 'outline-long-no-slides',
    category: 'Outline',
    label: 'Long outline (8 sections), no slides',
    note: 'Scrollable — fixed frame height shows the rail + scroll behaviour.',
    height: 600,
    render: () => h(OutlineView, { outline: OUTLINE_LONG_8, onJump: noop }),
  },
  {
    id: 'outline-long-many-slides',
    category: 'Outline',
    label: 'Long outline + many slides',
    note: 'Slides bucketed across sections; strip per section.',
    height: 600,
    render: () =>
      h(OutlineView, {
        outline: OUTLINE_LONG_8,
        slides: SLIDES_MANY,
        onJump: noop,
      }),
  },
  {
    id: 'outline-long-rail-dot-mode',
    category: 'Outline',
    label: 'Long outline @ 320 px — rail in dot mode',
    note: 'Width <420 px forces SectionRail dot column.',
    width: 320,
    height: 600,
    render: () => h(OutlineView, { outline: OUTLINE_LONG_8, onJump: noop }),
  },
  {
    id: 'outline-long-rail-text-460',
    category: 'Outline',
    label: 'Long outline @ 460 px — rail text-TOC',
    note: 'Width >=420 px → 132 px labeled mini-TOC column.',
    width: 460,
    height: 600,
    render: () => h(OutlineView, { outline: OUTLINE_LONG_8, onJump: noop }),
  },
  {
    id: 'outline-long-rail-text-560',
    category: 'Outline',
    label: 'Long outline @ 560 px — rail text-TOC wide',
    note: 'Roomier modal; same wide-rail mode.',
    width: 560,
    height: 600,
    render: () => h(OutlineView, { outline: OUTLINE_LONG_8, onJump: noop }),
  },
  {
    id: 'outline-compact-toggle-hint',
    category: 'Outline',
    label: 'Compact mode — click toggle in meta-row',
    note: 'Compact is internal React state; click the "Compact" toggle in the meta-row to enter exam-cram view.',
    height: 600,
    render: () => h(OutlineView, { outline: OUTLINE_LONG_8, onJump: noop }),
  },
  {
    id: 'outline-with-quizzes',
    category: 'Outline',
    label: 'Long outline — QuizRollup at bottom',
    note: 'OUTLINE_LONG_8 has 3 sections with check_question; roll-up renders.',
    height: 600,
    render: () => h(OutlineView, { outline: OUTLINE_LONG_8, onJump: noop }),
  },
  {
    id: 'outline-display-title-override',
    category: 'Outline',
    label: 'displayTitle override (editing)',
    note: 'displayTitle prop wins over outline.title.',
    height: 600,
    render: () =>
      h(OutlineView, {
        outline: OUTLINE_LONG_8,
        onJump: noop,
        displayTitle: '別タイトル(編集中)',
      }),
  },
  {
    id: 'outline-updated-at-3min-ago',
    category: 'Outline',
    label: 'outlineUpdatedAt — 3 min ago',
    note: 'RefreshIndicator renders relative time.',
    height: 600,
    render: () =>
      h(OutlineView, {
        outline: OUTLINE_LONG_8,
        onJump: noop,
        outlineUpdatedAt: Date.now() - 3 * 60 * 1000,
      }),
  },
  {
    id: 'outline-updated-at-just-now',
    category: 'Outline',
    label: 'outlineUpdatedAt — just now',
    note: 'Refresh indicator at "just now" copy branch.',
    height: 600,
    render: () =>
      h(OutlineView, {
        outline: OUTLINE_LONG_8,
        onJump: noop,
        outlineUpdatedAt: Date.now() - 2 * 1000,
      }),
  },
  {
    id: 'outline-updated-at-2hr-ago',
    category: 'Outline',
    label: 'outlineUpdatedAt — 2 h ago',
    note: 'Hour branch of the relative formatter.',
    height: 600,
    render: () =>
      h(OutlineView, {
        outline: OUTLINE_LONG_8,
        onJump: noop,
        outlineUpdatedAt: Date.now() - 2 * 3600 * 1000,
      }),
  },
  {
    id: 'outline-updated-at-2-days-ago',
    category: 'Outline',
    label: 'outlineUpdatedAt — 2 days ago (absolute)',
    note: 'Past 24 h: switches to absolute date+time form.',
    height: 600,
    render: () =>
      h(OutlineView, {
        outline: OUTLINE_LONG_8,
        onJump: noop,
        outlineUpdatedAt: Date.now() - 2 * 24 * 3600 * 1000,
      }),
  },
  {
    id: 'outline-short-with-displayTitle-and-updatedAt',
    category: 'Outline',
    label: 'Short outline + title override + timestamp',
    note: 'Compound state — header has both displayTitle and refresh chip.',
    render: () =>
      h(OutlineView, {
        outline: OUTLINE_SHORT_2,
        slides: SLIDES_FEW,
        onJump: noop,
        displayTitle: 'ベイズ入門 (短縮版)',
        outlineUpdatedAt: Date.now() - 45 * 1000,
      }),
  },
]
