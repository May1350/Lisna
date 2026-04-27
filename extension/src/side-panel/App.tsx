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

  // Two contexts share this app:
  //   - popout:     standalone window opened by SW (?tabId=N) → session view
  //   - side-panel: Chrome's built-in side panel (no params) → account view
  // The auth gate lives in the content script, so a popout is only ever
  // opened for a logged-in user.
  const ctx = useMemo(() => {
    const params = new URLSearchParams(location.search)
    const popoutTabIdRaw = params.get('tabId')
    const popoutTabId =
      popoutTabIdRaw !== null && Number.isFinite(Number(popoutTabIdRaw))
        ? Number(popoutTabIdRaw)
        : null
    return {
      isPopout: popoutTabId !== null,
      popoutTabId,
    }
  }, [])
  const { isPopout, popoutTabId } = ctx

  useEffect(() => { void hasConsent().then(setConsented) }, [])
  useEffect(() => { void getCurrentUser().then(setUser) }, [consented])

  // ON/OFF state — only meaningful in the side-panel (account) view, but we
  // load + subscribe regardless so the source of truth is storage.
  useEffect(() => {
    void getEnabled().then(setEnabledState)
    const off = onEnabledChange(setEnabledState)
    return off
  }, [])

  // Listen for SP_BROADCAST from content via SW — popout only.
  useEffect(() => {
    if (!isPopout) return
    const listener = (msg: { type: string; payload?: { type: string; sessionId?: string; url?: string } }) => {
      if (msg.type === 'SP_BROADCAST' && msg.payload?.type === 'session_started' && msg.payload.sessionId) {
        setSessionId(msg.payload.sessionId)
        setNotes([]); setSlides([])
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [isPopout])

  // Popout: load the existing session (if any) for the originating tab's URL.
  useEffect(() => {
    if (!isPopout || !user || popoutTabId === null) return
    void (async () => {
      let url: string | undefined
      let pageTitle = '講義ノート'
      try {
        const tab = await chrome.tabs.get(popoutTabId)
        url = tab.url
        pageTitle = tab.title || pageTitle
      } catch { /* tab gone */ }
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
  }, [user, isPopout, popoutTabId])

  // connect WS when sessionId arrives (popout only).
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
    // Works for both the popout window and the Chrome side panel context.
    window.close()
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
    if (isPopout && popoutTabId !== null) {
      await chrome.runtime.sendMessage({ type: 'STOP_SESSION', tabId: popoutTabId })
    }
    // Keep notes; clear sessionId so the WS disconnects and the StopButton hides.
    setSessionId(null)
  }, [isPopout, popoutTabId])

  if (consented === null) return null

  // Popout (session view). The content-script auth gate ensures we only land
  // here when the user is authed; a transient null user can occur on first
  // mount before getCurrentUser() resolves — render nothing rather than
  // flashing a login prompt.
  if (isPopout) {
    if (!user) return null
    return (
      <div className="min-h-screen flex flex-col bg-gray-50">
        <PanelHeader
          user={user}
          isPopout
          onClose={onClose}
          onLogout={onLogout}
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
