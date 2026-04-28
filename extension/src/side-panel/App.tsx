import { useEffect, useMemo, useState, useCallback } from 'react'
import type { NoteItem as N, SlideItem, User } from '../shared/types'
import { hasConsent, setConsent, getEnabled, onEnabledChange } from '../shared/storage'
import { ConsentModal } from './components/ConsentModal'
import { LoginScreen } from './components/LoginScreen'
import { NoteList } from './components/NoteList'
import { LiveTranscript } from './components/LiveTranscript'
import { DownloadButton } from './components/DownloadButton'
import { QuotaBanner } from './components/QuotaBanner'
import { PanelHeader } from './components/PanelHeader'
import { StopButton } from './components/StopButton'
import { callApi, connectWs, getCurrentUser, logout } from './api-client'
import type { LiveTranscriptItem } from './api-client'

export default function App() {
  const [consented, setConsented] = useState<boolean | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [notes, setNotes] = useState<N[]>([])
  const [slides, setSlides] = useState<SlideItem[]>([])
  // Live transcript items (streamed from /v1/stream/audio's STT step before
  // LLM finishes). Bounded ring buffer — we only keep the last ~30 chunks
  // (≈5 min at 10 s chunks) so the UI stays responsive on long sessions.
  const [transcripts, setTranscripts] = useState<LiveTranscriptItem[]>([])
  const [title, setTitle] = useState('講義ノート')
  const [enabled, setEnabledState] = useState<boolean>(true)
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(2)

  // Two contexts share this app:
  //   - embed:      iframe modal injected into the page (?embed=1&parentUrl=…)
  //                 → session view + in-modal login if not authed.
  //   - side-panel: Chrome's built-in side panel (no params) → account view.
  const ctx = useMemo(() => {
    const params = new URLSearchParams(location.search)
    const isEmbed = params.has('embed')
    const parentUrl = params.get('parentUrl')
    return { isEmbed, parentUrl }
  }, [])
  const { isEmbed, parentUrl } = ctx

  useEffect(() => { void hasConsent().then(setConsented) }, [])
  useEffect(() => { void getCurrentUser().then(setUser) }, [consented])

  // ON/OFF state — only meaningful in the side-panel (account) view, but we
  // load + subscribe regardless so the source of truth is storage.
  useEffect(() => {
    void getEnabled().then(setEnabledState)
    const off = onEnabledChange(setEnabledState)
    return off
  }, [])

  // Initial playback speed from storage. Shared key with the options page.
  useEffect(() => {
    void chrome.storage.local.get('sh.playback').then(r => {
      const stored = r['sh.playback']
      if (typeof stored === 'number') setPlaybackSpeed(stored)
      else if (stored === 'auto' || stored === undefined) setPlaybackSpeed(2)
    })
  }, [])

  // Listen for SP_BROADCAST from content via SW — embed only.
  useEffect(() => {
    if (!isEmbed) return
    const listener = (msg: { type: string; payload?: { type: string; sessionId?: string; url?: string } }) => {
      if (msg.type === 'SP_BROADCAST' && msg.payload?.type === 'session_started' && msg.payload.sessionId) {
        setSessionId(msg.payload.sessionId)
        setNotes([]); setSlides([]); setTranscripts([])
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [isEmbed])

  // Embed: load the existing session (if any) for the parent page's URL.
  useEffect(() => {
    if (!isEmbed || !user || !parentUrl) return
    void (async () => {
      setTitle('講義ノート')
      try {
        const r = await callApi<{ session: { id: string; notes: N[]; slides: SlideItem[] } | null }>(
          `/v1/session?url=${encodeURIComponent(parentUrl)}`, 'GET'
        )
        if (r.session) {
          setSessionId(r.session.id)
          setNotes(r.session.notes || [])
          setSlides(r.session.slides || [])
        }
      } catch { /* ignore */ }
    })()
  }, [user, isEmbed, parentUrl])

  // connect WS when sessionId arrives (embed only).
  useEffect(() => {
    if (!sessionId) return
    let mounted = true
    let ws: WebSocket | null = null
    void (async () => {
      const w = await connectWs(sessionId, {
        onNote: (newNotes) => setNotes(prev => [...prev, ...newNotes]),
        onSlide: (s) => setSlides(prev => [...prev, s]),
        onTranscript: (item) => {
          // Bounded ring buffer — drop the oldest when we exceed 30 entries
          // (~5 min at 10 s chunks). Keeps DOM size and re-render cost
          // bounded on long sessions.
          setTranscripts(prev => {
            const next = [...prev, item]
            return next.length > 30 ? next.slice(next.length - 30) : next
          })
        },
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
      window.parent.postMessage({ type: 'SH_CLOSE_MODAL' }, '*')
    } else {
      window.close()
    }
  }, [isEmbed])

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

  const onSpeedChange = useCallback((speed: number) => {
    setPlaybackSpeed(speed)
    void chrome.storage.local.set({ 'sh.playback': speed })
    // Inform the parent content script so it can apply to the active video
    // immediately. Only meaningful in embed mode (modal inside the page).
    if (isEmbed) {
      window.parent.postMessage({ type: 'SH_SET_SPEED', speed }, '*')
    }
  }, [isEmbed])

  const onStop = useCallback(async () => {
    // Stop the active capture in whichever tab the modal is hosted in.
    // Embed runs inside the page, so we don't have a direct tabId; the SW
    // forwards STOP_SESSION to the active tab via tabs.sendMessage.
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.id !== undefined) {
      await chrome.runtime.sendMessage({ type: 'STOP_SESSION', tabId: tab.id })
    }
    // Keep notes; clear sessionId so the WS disconnects and the StopButton hides.
    setSessionId(null)
  }, [])

  if (consented === null) return null

  // Embed (in-page modal) — handles its own auth flow.
  if (isEmbed) {
    if (!consented) {
      return <ConsentModal onAccept={async () => { await setConsent(); setConsented(true) }} />
    }
    if (!user) {
      return (
        <LoginScreen
          currentUrl={parentUrl ?? undefined}
          onSuccess={(result) => {
            // setUser triggers the useEffect that loads existing session via
            // GET /v1/session as a fallback path. But the backend just gave
            // us that session in the same response — apply it eagerly so the
            // user sees notes the moment they land on the session view.
            setUser(result.user)
            if (result.currentSession) {
              setSessionId(result.currentSession.id)
              setNotes(result.currentSession.notes ?? [])
              setSlides(result.currentSession.slides ?? [])
            }
          }}
        />
      )
    }
    return (
      <div className="min-h-screen flex flex-col bg-gray-50">
        <PanelHeader
          user={user}
          isEmbed
          playbackSpeed={playbackSpeed}
          onSpeedChange={onSpeedChange}
          onClose={onClose}
          onLogout={onLogout}
        />
        <NoteList notes={notes} slides={slides} />
        {sessionId && <LiveTranscript items={transcripts} />}
        <div className="px-3 pb-3 space-y-2">
          {sessionId && <StopButton onStop={onStop} />}
          {sessionId && notes.length > 0 && <DownloadButton sessionId={sessionId} title={title} />}
        </div>
      </div>
    )
  }

  // Side-panel (account) view: consent + auth flow lives here.
  if (!consented) return <ConsentModal onAccept={async () => { await setConsent(); setConsented(true) }} />
  // No currentUrl in the side panel — there's no parent video page; the
  // existing-session lookup isn't useful here.
  if (!user) return <LoginScreen onSuccess={(r) => setUser(r.user)} />

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <PanelHeader
        user={user}
        isEmbed={false}
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
