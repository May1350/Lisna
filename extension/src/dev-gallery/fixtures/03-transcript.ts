import type { GalleryFixture } from './types'
import { createElement as h, useEffect } from 'react'
import { LiveTranscript } from '../../side-panel/components/LiveTranscript'
import { TRANSCRIPT_EMPTY, TRANSCRIPT_SHORT, TRANSCRIPT_LONG } from './_mock-data'

const CATEGORY = 'Live transcript'

// Tiny wrapper that flips the captions-collapsed storage flag on mount,
// so LiveTranscript hydrates into its collapsed visual state. The
// component reads chrome.storage.local.get(...) inside a useEffect on
// mount; the gallery's chrome-mock resolves synchronously enough that
// the collapsed branch is the first paint observers see.
function CollapsedLiveTranscript(props: { items: typeof TRANSCRIPT_LONG; videoPlaying: boolean }) {
  useEffect(() => {
    const setStorage = (globalThis as Record<string, unknown>).__galleryStorage as
      | ((seed: Record<string, unknown>) => void)
      | undefined
    setStorage?.({ 'sh.captionsCollapsed': true })
  }, [])
  return h(LiveTranscript, props)
}

export const transcriptFixtures: GalleryFixture[] = [
  {
    id: 'live-transcript-empty-playing',
    category: CATEGORY,
    label: 'LiveTranscript — empty, playing',
    note: 'Green dot + "音声処理中…" placeholder.',
    render: () => h(LiveTranscript, { items: TRANSCRIPT_EMPTY, videoPlaying: true }),
  },
  {
    id: 'live-transcript-empty-paused',
    category: CATEGORY,
    label: 'LiveTranscript — empty, paused',
    note: 'ink-500 dot + "一時停止中" placeholder.',
    render: () => h(LiveTranscript, { items: TRANSCRIPT_EMPTY, videoPlaying: false }),
  },
  {
    id: 'live-transcript-empty-unknown',
    category: CATEGORY,
    label: 'LiveTranscript — empty, unknown state',
    note: 'ink-300 dot + "待機中…" placeholder.',
    render: () => h(LiveTranscript, { items: TRANSCRIPT_EMPTY, videoPlaying: null }),
  },
  {
    id: 'live-transcript-short',
    category: CATEGORY,
    label: 'LiveTranscript — short transcript',
    note: '3 items, fits without scroll.',
    render: () => h(LiveTranscript, { items: TRANSCRIPT_SHORT, videoPlaying: true }),
  },
  {
    id: 'live-transcript-long',
    category: CATEGORY,
    label: 'LiveTranscript — long transcript (scrollable)',
    note: '24 items inside max-h-32 scroll region.',
    height: 320,
    render: () => h(LiveTranscript, { items: TRANSCRIPT_LONG, videoPlaying: true }),
  },
  {
    id: 'live-transcript-long-collapsed',
    category: CATEGORY,
    label: 'LiveTranscript — collapsed via storage flag',
    note: 'sh.captionsCollapsed=true seeded; only header visible.',
    render: () => h(CollapsedLiveTranscript, { items: TRANSCRIPT_LONG, videoPlaying: true }),
  },
]
