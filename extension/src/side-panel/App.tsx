import { useEffect, useMemo, useState, useCallback } from 'react'
import type { NoteItem as N, SlideItem, User } from '../shared/types'
import { hasConsent, setConsent, getEnabled, onEnabledChange } from '../shared/storage'
import { ConsentModal } from './components/ConsentModal'
import { LoginScreen } from './components/LoginScreen'
import { NoteList } from './components/NoteList'
import { DownloadButton } from './components/DownloadButton'
import { QuotaBanner } from './components/QuotaBanner'
import { PanelHeader } from './components/PanelHeader'
import { StopButton } from './components/StopButton'
import { callApi, connectWs, getCurrentUser, logout } from './api-client'

export default function App() {
  const [consented, setConsented] = useState<boolean | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [notes, setNotes] = useState<N[]>([])
  const [slides, setSlides] = useState<SlideItem[]>([])
  const [title, setTitle] = useState('講義ノート')
  const [enabled, setEnabledState] = useState<boolean>(true)

  // Three contexts share this app:
  //   - embed:      iframe injected by content script (?embed=1&parentUrl=…)
  //   - popout:     standalone window opened by SW (?tabId=N)
  //   - side-panel: Chrome's built-in side panel (no params)
  const ctx = useMemo(() => {
    const params = new URLSearchParams(location.search)
    const isEmbed = params.has('embed')
    const parentUrl = params.get('parentUrl')
    const popoutTabIdRaw = params.get('tabId')
    const popoutTabId = !isEmbed && popoutTabIdRaw !== null
      ? Number.isFinite(Number(popoutTabIdRaw)) ? Number(popoutTabIdRaw) : null
      : null
    return {
      isEmbed,
      parentUrl,
      isPopout: !isEmbed && popoutTabId !== null,
      popoutTabId,
    }
  }, [])
  const { isEmbed, parentUrl, isPopout, popoutTabId } = ctx
  // The "session view" (notes / WS / capture controls) is shown for both
  // embed and popout. The side-panel context shows the account view only.
  const isSessionView = isEmbed || isPopout

  useEffect(() => { void hasConsent().then(setConsented) }, [])
  useEffect(() => { void getCurrentUser().then(setUser) }, [consented])

  // ON/OFF state — only meaningful in the side-panel (account) view, but we
  // load + subscribe regardless so the source of truth is storage.
  useEffect(() => {
    void getEnabled().then(setEnabledState)
    const off = onEnabledChange(setEnabledState)
    return off
  }, [])

  // listen for SP_BROADCAST from content via SW (session views only — the
  // side panel never shows session UI, so we ignore it there even if it arrives).
  useEffect(() => {
    if (!isSessionView) return
    const listener = (msg: { type: string; payload?: { type: string; sessionId?: string; url?: string } }) => {
      if (msg.type === 'SP_BROADCAST' && msg.payload?.type === 'session_started' && msg.payload.sessionId) {
        setSessionId(msg.payload.sessionId)
        setNotes([]); setSlides([])
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [isSessionView])

  // Session views: load the existing session (if any) for the page's URL.
  // - embed:  parentUrl is supplied directly by the content script.
  // - popout: look up the originating tab by id.
  useEffect(() => {
    if (!isSessionView || !user) return
    void (async () => {
      let url: string | undefined
      let pageTitle = '講義ノート'
      if (isEmbed && parentUrl) {
        url = parentUrl
        pageTitle = document.title || pageTitle
      } else if (isPopout && popoutTabId !== null) {
        try {
          const tab = await chrome.tabs.get(popoutTabId)
          url = tab.url
          pageTitle = tab.title || pageTitle
        } catch { /* tab gone */ }
      }
      if (!url) return
      setTitle(pageTitle)
      try {
        const r = await callApi<{ session: { id: string; notes: N[]; slides: SlideItem[] } | null }>(
          `/v1/session?url=${encodeURIComponent(url)}`, 'GET'
        )
        if (r.session) {
          setSessionId(r.session.id)
          setNotes(r.session.notes || [])
          setSlides(r.session.slides || [])
        }
      } catch { /* ignore */ }
    })()
  }, [user, isSessionView, isEmbed, parentUrl, isPopout, popoutTabId])

  // connect WS when sessionId arrives (session views only).
  useEffect(() => {
    if (!sessionId) return
    let mounted = true
    let ws: WebSocket | null = null
    void (async () => {
      const w = await connectWs(sessionId, {
        onNote: (newNotes) => setNotes(prev => [...prev, ...newNotes]),
        onSlide: (s) => setSlides(prev => [...prev, s]),
        onClose: () => {},
      })
      if (mounted) ws = w
      else w.close()
    })()
    return () => { mounted = false; ws?.close() }
  }, [sessionId])

  const onUpgrade = useCallback(async () => {
    const r = await callApi<{ url: string }>('/v1/billing/checkout', 'POST', {})
    chrome.tabs.create({ url: r.url })
  }, [])

  const onClose = useCallback(() => {
    if (isEmbed) {
      // Ask the content script to slide the iframe out and remove it.
      window.parent.postMessage({ type: 'SH_CLOSE_SIDEBAR' }, '*')
    } else {
      // Works for both the popout window and the Chrome side panel context.
      window.close()
    }
  }, [isEmbed])

  const onSwitchToPopout = useCallback(() => {
    // Tell content script to open a popout window + close the iframe sidebar.
    window.parent.postMessage({ type: 'SH_SWITCH_TO_POPOUT' }, '*')
  }, [])

  const onLogout = useCallback(async () => {
    await logout()
    setUser(null)
    setSessionId(null)
    setNotes([])
    setSlides([])
  }, [])

  const onToggleEnabled = useCallback(async (next: boolean) => {
    // Optimistic — storage event will reconcile if it fails.
    setEnabledState(next)
    await chrome.runtime.sendMessage({ type: 'TOGGLE_ENABLED', enabled: next })
  }, [])

  const onStop = useCallback(async () => {
    // For popout: STOP_SESSION needs the originating tab id.
    // For embed: the content script lives on the active tab, so let SW resolve via sender.
    if (isPopout && popoutTabId !== null) {
      await chrome.runtime.sendMessage({ type: 'STOP_SESSION', tabId: popoutTabId })
    } else if (isEmbed) {
      // The active tab is the one hosting the iframe (this very page's parent).
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab?.id !== undefined) {
        await chrome.runtime.sendMessage({ type: 'STOP_SESSION', tabId: tab.id })
      }
    }
    // Keep notes; clear sessionId so the WS disconnects and the StopButton hides.
    setSessionId(null)
  }, [isPopout, popoutTabId, isEmbed])

  if (consented === null) return null

  // Session view (embed OR popout). Both assume the user is already authed
  // (the inline 📚 button only mounts when enabled and the user has a session
  // available via the side panel). Provide a graceful fallback if not.
  if (isSessionView) {
    if (!user) {
      if (isEmbed) {
        return (
          <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6 text-center">
            <p className="text-sm text-gray-700">
              Studyヘルパーアイコンをクリックしてログインしてください。
            </p>
          </div>
        )
      }
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6 text-center">
          <p className="text-sm text-gray-700">
            サイドパネルでログインしてください。
          </p>
        </div>
      )
    }
    return (
      <div className="min-h-screen flex flex-col bg-gray-50">
        <PanelHeader
          user={user}
          isEmbed={isEmbed}
          isPopout={isPopout}
          onClose={onClose}
          onLogout={onLogout}
          onSwitchToPopout={isEmbed ? onSwitchToPopout : undefined}
        />
        <NoteList notes={notes} slides={slides} />
        <div className="px-3 pb-3 space-y-2">
          {sessionId && <StopButton onStop={onStop} />}
          {sessionId && notes.length > 0 && <DownloadButton sessionId={sessionId} title={title} />}
        </div>
      </div>
    )
  }

  // Side-panel (account) view: consent + auth flow lives here.
  if (!consented) return <ConsentModal onAccept={async () => { await setConsent(); setConsented(true) }} />
  if (!user) return <LoginScreen onSuccess={() => getCurrentUser().then(setUser)} />

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <PanelHeader
        user={user}
        isEmbed={false}
        isPopout={false}
        enabled={enabled}
        onToggleEnabled={onToggleEnabled}
        onClose={onClose}
        onLogout={onLogout}
      />
      <QuotaBanner user={user} onUpgrade={onUpgrade} />
      <div className="px-3 py-3 text-xs text-gray-600 leading-relaxed">
        動画ページで星アイコンをクリックすると要約が始まります。
      </div>
    </div>
  )
}
