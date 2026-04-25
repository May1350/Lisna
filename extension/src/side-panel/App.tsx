import { useEffect, useState, useCallback } from 'react'
import type { NoteItem as N, SlideItem, User } from '../shared/types'
import { hasConsent, setConsent } from '../shared/storage'
import { ConsentModal } from './components/ConsentModal'
import { LoginScreen } from './components/LoginScreen'
import { NoteList } from './components/NoteList'
import { DownloadButton } from './components/DownloadButton'
import { QuotaBanner } from './components/QuotaBanner'
import { callApi, connectWs, getCurrentUser } from './api-client'

export default function App() {
  const [consented, setConsented] = useState<boolean | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [notes, setNotes] = useState<N[]>([])
  const [slides, setSlides] = useState<SlideItem[]>([])
  const [title, setTitle] = useState('講義ノート')

  useEffect(() => { hasConsent().then(setConsented) }, [])
  useEffect(() => { getCurrentUser().then(setUser) }, [consented])

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

  // load existing session for current url
  useEffect(() => {
    void (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
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
  }, [user])

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

  if (consented === null) return null
  if (!consented) return <ConsentModal onAccept={async () => { await setConsent(); setConsented(true) }} />
  if (!user) return <LoginScreen onSuccess={() => getCurrentUser().then(setUser)} />

  return (
    <div className="min-h-screen flex flex-col">
      <QuotaBanner user={user} onUpgrade={onUpgrade} />
      <NoteList notes={notes} slides={slides} />
      {sessionId && notes.length > 0 && <DownloadButton sessionId={sessionId} title={title} />}
    </div>
  )
}
