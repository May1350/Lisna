import { useCallback, useEffect, useState } from 'react'
import { callApi, ApiError, type Outline } from '../api-client'
import type { SlideItem } from '../../shared/types'
import { useT } from '../../shared/i18n'
import { reportError } from '../../shared/errors'
import { OutlineView } from './OutlineView'
import { BackIcon, ExternalLinkIcon } from './icons'
import type { SessionSummary } from './SessionHistory'

interface FetchedSession {
  id: string
  outline?: Outline | null
  slides?: SlideItem[]
  url_original?: string
  updated_at?: string
}

interface Props {
  session: SessionSummary
  onBack: () => void
  /** Bubble up 401 so the side panel re-shows LoginScreen, mirroring
   *  SessionHistory's contract. */
  onAuthExpired?: () => void
}

// History row → "view notes" surface. Re-uses the existing OutlineView
// renderer with an outline fetched on demand by the row's URL via
// GET /v1/session?url=… (same endpoint the modal uses on hydrate, so
// no new backend wiring). Kept narrow on purpose:
//   - read-only: editing flows are out of scope for v1
//   - fetch-on-mount: no caching layer; the backend round-trip is fast
//     and the user usually visits one row at a time
//   - onJump opens a new tab at <url>?t=<sec>&__sh_seek=<sec> so the
//     content script's __sh_seek auto-seek (content/index.ts:271)
//     lands them at the right point — there's no <video> reachable
//     from the side panel itself
export function NotesViewer({ session, onBack, onAuthExpired }: Props) {
  const T = useT()
  const [data, setData] = useState<FetchedSession | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'not_found' | 'failed'>('loading')

  const load = useCallback(async () => {
    setState('loading')
    try {
      const r = await callApi<{ session: FetchedSession | null }>(
        `/v1/session?url=${encodeURIComponent(session.url)}`,
        'GET',
      )
      if (!r.session) {
        setState('not_found')
        return
      }
      setData(r.session)
      setState('ok')
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        onAuthExpired?.()
        return
      }
      void reportError(e instanceof Error ? e : new Error(String(e)), { context: 'NotesViewer.load' })
      setState('failed')
    }
  }, [session.url, onAuthExpired])

  useEffect(() => { void load() }, [load])

  // Side-panel jump: open the source URL in a new tab with both the
  // platform-native ?t=Ns AND our __sh_seek marker. The content script
  // on the destination page consumes __sh_seek to override platform
  // resume-position behaviour (which can otherwise drop the user back
  // at where they last left off).
  const onJump = useCallback((ts: number) => {
    const sec = Math.max(0, Math.floor(ts))
    const sep = session.url.includes('?') ? '&' : '?'
    const url = `${session.url}${sep}t=${sec}s&__sh_seek=${sec}`
    void chrome.tabs.create({ url, active: true })
  }, [session.url])

  const onOpenSource = useCallback(() => {
    void chrome.tabs.create({ url: session.url, active: true })
  }, [session.url])

  const headerTitle = data?.outline?.title?.trim()
    || session.title?.trim()
    || T.sidePanel.historyTitle_untitled

  return (
    <div className="flex flex-col h-screen bg-paper-100">
      <Header
        title={headerTitle}
        backLabel={T.sidePanel.notesViewer_back}
        openLabel={T.sidePanel.notesViewer_openSource}
        onBack={onBack}
        onOpenSource={onOpenSource}
      />
      <div className="flex-1 overflow-y-auto">
        {state === 'loading' && <LoadingBlock copy={T.sidePanel.notesViewer_loading} />}
        {state === 'not_found' && (
          <EmptyBlock copy={T.sidePanel.notesViewer_notFound} onBack={onBack} backLabel={T.sidePanel.notesViewer_back} />
        )}
        {state === 'failed' && (
          <EmptyBlock copy={T.sidePanel.notesViewer_loadFailed} onBack={onBack} backLabel={T.sidePanel.notesViewer_back} />
        )}
        {state === 'ok' && data && !data.outline && (
          <EmptyBlock copy={T.sidePanel.notesViewer_noOutline} onBack={onBack} backLabel={T.sidePanel.notesViewer_back} />
        )}
        {state === 'ok' && data?.outline && (
          <OutlineView
            outline={data.outline}
            slides={data.slides ?? []}
            onJump={onJump}
            displayTitle={headerTitle}
          />
        )}
      </div>
    </div>
  )
}

function Header({
  title, backLabel, openLabel, onBack, onOpenSource,
}: {
  title: string
  backLabel: string
  openLabel: string
  onBack: () => void
  onOpenSource: () => void
}) {
  return (
    <div className="sticky top-0 z-10 flex items-center gap-2 px-3 py-2 bg-white/95 backdrop-blur border-b border-paper-edge">
      <button
        type="button"
        onClick={onBack}
        aria-label={backLabel}
        title={backLabel}
        className="flex items-center gap-1 px-2 py-1 text-xs text-ink-700 hover:text-ink-900 rounded hover:bg-paper-300 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra"
      >
        <BackIcon size={14} />
        <span>{backLabel}</span>
      </button>
      <span className="flex-1 text-xs font-medium text-ink-900 truncate" title={title}>
        {title}
      </span>
      <button
        type="button"
        onClick={onOpenSource}
        aria-label={openLabel}
        title={openLabel}
        className="p-1 rounded text-ink-300 hover:text-ink-900 hover:bg-paper-300 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra"
      >
        <ExternalLinkIcon size={14} />
      </button>
    </div>
  )
}

function LoadingBlock({ copy }: { copy: string }) {
  return (
    <div className="px-4 py-6">
      <div className="text-xs text-ink-500 mb-3">{copy}</div>
      <div className="space-y-2">
        <div className="h-3 w-2/3 bg-ink-200 rounded animate-pulse" />
        <div className="h-3 w-5/6 bg-ink-200 rounded animate-pulse" />
        <div className="h-3 w-1/2 bg-ink-200 rounded animate-pulse" />
        <div className="h-3 w-3/4 bg-ink-200 rounded animate-pulse" />
        <div className="h-3 w-2/3 bg-ink-200 rounded animate-pulse" />
      </div>
    </div>
  )
}

function EmptyBlock({
  copy, onBack, backLabel,
}: {
  copy: string
  onBack: () => void
  backLabel: string
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-6 py-12 gap-3">
      <p className="text-xs text-ink-700">{copy}</p>
      <button
        type="button"
        onClick={onBack}
        className="text-xs text-ink-900 hover:text-terra-700 underline-offset-2 hover:underline"
      >
        {backLabel}
      </button>
    </div>
  )
}
