import { useEffect, useMemo, useState, useCallback } from 'react'
import type { NoteItem as N, SlideItem, User } from '../shared/types'
import { hasConsent, setConsent, getDisplayMode, type DisplayMode } from '../shared/storage'
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
  const [mode, setMode] = useState<DisplayMode>('side-panel')

  // Detect popout: when launched as a popup window we pass ?tabId=<n>.
  const popoutTabId = useMemo(() => {
    const v = new URLSearchParams(location.search).get('tabId')
    if (!v) return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }, [])
  const isPopout = popoutTabId !== null

  useEffect(() => { hasConsent().then(setConsented) }, [])
  useEffect(() => { getCurrentUser().then(setUser) }, [consented])
  useEffect(() => { getDisplayMode().then(setMode) }, [])

  // listen for SP_BROADCAST from content via SW
  useEffect(() => {
    const listener = (msg: { type: string; payload?: { type: string; sessionId?: string; url?: string } }) => {
      if (msg.type === 'SP_BROADCAST' && msg.payload?.type === 'session_started' && msg.payload.sessionId) {
        setSessionId(msg.payload.sessionId)
        setNotes([]); setSlides([])
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [])

  // load existing session for current url. In popout mode, we look up the
  // originating tab via the tabId query param; in side-panel mode we use the
  // active tab in the current window.
  useEffect(() => {
    if (!user) return
    void (async () => {
      let tab: chrome.tabs.Tab | undefined
      if (isPopout && popoutTabId !== null) {
        try { tab = await chrome.tabs.get(popoutTabId) } catch { /* tab gone */ }
      } else {
        const [t] = await chrome.tabs.query({ active: true, currentWindow: true })
        tab = t
      }
      if (!tab?.url) return
      setTitle(tab.title || '講義ノート')
      try {
        const r = await callApi<{ session: { id: string; notes: N[]; slides: SlideItem[] } | null }>(
          `/v1/session?url=${encodeURIComponent(tab.url)}`, 'GET'
        )
        if (r.session) {
          setSessionId(r.session.id)
          setNotes(r.session.notes || [])
          setSlides(r.session.slides || [])
        }
      } catch { /* ignore */ }
    })()
  }, [user, isPopout, popoutTabId])

  // connect WS when sessionId arrives
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

  const resolveSourceTabId = useCallback(async (): Promise<number | null> => {
    if (isPopout && popoutTabId !== null) return popoutTabId
    const [t] = await chrome.tabs.query({ active: true, currentWindow: true })
    return t?.id ?? null
  }, [isPopout, popoutTabId])

  const onSwitchMode = useCallback(async () => {
    const tabId = await resolveSourceTabId()
    if (tabId === null) return
    const next: DisplayMode = isPopout ? 'side-panel' : 'popout'
    await chrome.runtime.sendMessage({ type: 'SWITCH_MODE', mode: next, tabId })
    // For side-panel → popout: close ourselves so only the popout remains.
    if (!isPopout) {
      window.close()
    }
    // For popout → side-panel: SW closes our window.
  }, [isPopout, resolveSourceTabId])

  const onClose = useCallback(() => {
    // Works for both popout windows and the Chrome side panel context.
    window.close()
  }, [])

  const onLogout = useCallback(async () => {
    await logout()
    setUser(null)
    setSessionId(null)
    setNotes([])
    setSlides([])
  }, [])

  const onStop = useCallback(async () => {
    const tabId = await resolveSourceTabId()
    if (tabId === null) return
    await chrome.runtime.sendMessage({ type: 'STOP_SESSION', tabId })
    // Keep notes; clear sessionId so the WS disconnects and the StopButton hides.
    setSessionId(null)
  }, [resolveSourceTabId])

  if (consented === null) return null
  if (!consented) return <ConsentModal onAccept={async () => { await setConsent(); setConsented(true) }} />
  if (!user) return <LoginScreen onSuccess={() => getCurrentUser().then(setUser)} />

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <PanelHeader
        user={user}
        mode={mode}
        isPopout={isPopout}
        onSwitchMode={onSwitchMode}
        onClose={onClose}
        onLogout={onLogout}
      />
      <QuotaBanner user={user} onUpgrade={onUpgrade} />
      <NoteList notes={notes} slides={slides} />
      <div className="px-3 pb-3 space-y-2">
        {sessionId && <StopButton onStop={onStop} />}
        {sessionId && notes.length > 0 && <DownloadButton sessionId={sessionId} title={title} />}
      </div>
    </div>
  )
}
