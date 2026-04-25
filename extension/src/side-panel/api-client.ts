import { WS_URL } from '../shared/config'
import type { NoteItem, SlideItem, User } from '../shared/types'
import { getToken } from '../shared/storage'

export async function callApi<T = unknown>(path: string, method: string, body?: unknown): Promise<T> {
  const r = await chrome.runtime.sendMessage({ type: 'API_FETCH', path, method, body })
  if (!r.ok) throw new Error(r.error)
  return r.data as T
}

export async function login(): Promise<User> {
  const r = await chrome.runtime.sendMessage({ type: 'AUTH_LOGIN' })
  if (!r.ok) throw new Error(r.error)
  return r.data as User
}

export async function logout(): Promise<void> {
  await chrome.runtime.sendMessage({ type: 'AUTH_LOGOUT' })
}

export async function getCurrentUser(): Promise<User | null> {
  const r = await chrome.runtime.sendMessage({ type: 'AUTH_GET_USER' })
  return r.ok ? r.data as User | null : null
}

export interface WsListeners {
  onNote: (notes: NoteItem[]) => void
  onSlide: (slide: SlideItem) => void
  onClose: () => void
}

export async function connectWs(sessionId: string, listeners: WsListeners): Promise<WebSocket> {
  const token = await getToken()
  const url = `${WS_URL}?token=${encodeURIComponent(token!)}&session_id=${sessionId}`
  const ws = new WebSocket(url)
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data)
      if (msg.type === 'note_chunk') listeners.onNote(msg.notes)
      else if (msg.type === 'slide_chunk') listeners.onSlide(msg.slide)
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
