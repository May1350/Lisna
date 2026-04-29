import { WS_URL } from '../shared/config'
import type { NoteItem, SlideItem, User } from '../shared/types'
import { getToken } from '../shared/storage'

export async function callApi<T = unknown>(path: string, method: string, body?: unknown): Promise<T> {
  const r = await chrome.runtime.sendMessage({ type: 'API_FETCH', path, method, body })
  if (!r.ok) throw new Error(r.error)
  return r.data as T
}

export interface LoginResult {
  user: User
  currentSession: {
    id: string
    notes: NoteItem[]
    slides: SlideItem[]
    outline: Outline | null
  } | null
}

/**
 * Trigger Google OAuth via the SW. If `currentUrl` is provided, the backend
 * also returns the user's existing session for that URL in the same
 * response so the modal can hydrate notes immediately without a follow-up
 * GET /v1/session round-trip.
 */
export async function login(currentUrl?: string): Promise<LoginResult> {
  const r = await chrome.runtime.sendMessage({ type: 'AUTH_LOGIN', currentUrl })
  if (!r.ok) throw new Error(r.error)
  return r.data as LoginResult
}

export async function logout(): Promise<void> {
  await chrome.runtime.sendMessage({ type: 'AUTH_LOGOUT' })
}

export async function getCurrentUser(): Promise<User | null> {
  const r = await chrome.runtime.sendMessage({ type: 'AUTH_GET_USER' })
  return r.ok ? r.data as User | null : null
}

export interface LiveTranscriptItem {
  ts: number       // absolute video time (seconds, from chunk start_time_sec)
  text: string
}

// Outline shape mirrors backend/src/lib/curator.ts. Kept inline here rather
// than imported because the extension build doesn't share the backend's
// tsconfig path mappings.
export interface OutlineKeyTerm { term: string; definition: string; ts: number }
export interface OutlineExample { text: string; ts: number }
export interface OutlinePoint { text: string; ts: number; important: boolean }
export interface OutlineSection {
  heading: string
  ts: number
  summary: string
  key_terms: OutlineKeyTerm[]
  examples: OutlineExample[]
  points: OutlinePoint[]
}
export interface Outline {
  title: string
  sections: OutlineSection[]
}

export interface WsListeners {
  onNote: (notes: NoteItem[]) => void
  onSlide: (slide: SlideItem) => void
  onTranscript: (item: LiveTranscriptItem) => void
  onOutline: (outline: Outline) => void
  onClose: () => void
}

export async function connectWs(sessionId: string, listeners: WsListeners): Promise<WebSocket> {
  const token = await getToken()
  const url = `${WS_URL}?token=${encodeURIComponent(token!)}&session_id=${sessionId}`
  const ws = new WebSocket(url)
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data)
      if (msg.type === 'note_chunk') listeners.onNote(msg.notes as NoteItem[])
      else if (msg.type === 'transcript_chunk') {
        listeners.onTranscript({ ts: msg.ts as number, text: msg.text as string })
      } else if (msg.type === 'outline_updated') {
        listeners.onOutline(msg.outline as Outline)
      } else if (msg.type === 'slide_chunk') {
        const s = msg.slide as { ts: number; key: string; url: string }
        listeners.onSlide({ ts: s.ts, key: s.key, url: s.url })
      }
    } catch { /* ignore */ }
  }
  ws.onclose = () => listeners.onClose()
  return ws
}

export async function jumpToTimestamp(ts: number): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab.id) return
  await chrome.tabs.sendMessage(tab.id, { type: 'JUMP_TO', ts })
}

/** Phase 6.1: on-demand curator. Trigger when the user pauses / stops /
 *  ends the lecture, or hits "📝 ノートを生成". Backend reads the full
 *  transcript log for this session and produces (or rewrites) the outline.
 *  WS broadcasts the result, so the modal also receives it via onOutline. */
export async function triggerCurate(sessionId: string, fullRewrite = false): Promise<Outline | null> {
  const r = await callApi<{ outline: Outline | null; reason?: string }>(
    '/v1/session/curate', 'POST', { session_id: sessionId, full_rewrite: fullRewrite },
  )
  return r.outline
}
