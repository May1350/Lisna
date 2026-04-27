export interface User {
  id: string
  email: string
  name?: string
  plan: 'free' | 'pro'
}

export interface NoteItem {
  ts: number
  text: string
  important: boolean
}

export interface SlideItem {
  ts: number
  key: string
  url: string
}

export interface SessionState {
  id: string
  url: string
  notes: NoteItem[]
  slides: SlideItem[]
  status: 'active' | 'finalized' | 'deleted'
}

export type SwRequest =
  | { type: 'AUTH_LOGIN' }
  | { type: 'AUTH_LOGOUT' }
  | { type: 'AUTH_GET_USER' }
  | { type: 'API_FETCH'; path: string; method: string; body?: unknown }
  | { type: 'SESSION_START'; tabId: number; url: string }
  // Inline 📚 button on a video → SW always opens a popout window for the session.
  | { type: 'OPEN_VIEW'; tabId?: number }
  // Side-panel ON/OFF switch flips global enable state, badge, and content scripts.
  | { type: 'TOGGLE_ENABLED'; enabled: boolean }
  | { type: 'STOP_SESSION'; tabId: number }

export type SwResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: string }

// Augment HTMLVideoElement to include captureStream (not yet in lib.dom standard typings everywhere).
declare global {
  interface HTMLVideoElement {
    captureStream(): MediaStream
  }
}
