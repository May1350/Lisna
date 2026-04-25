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
  slideKey?: string
}

export interface SlideItem {
  ts: number
  key: string
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
  | { type: 'TOAST_SHOW'; tabId: number }
  | { type: 'SESSION_START'; tabId: number; url: string }

export type SwResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: string }

// Augment HTMLVideoElement to include captureStream (not yet in lib.dom standard typings everywhere).
declare global {
  interface HTMLVideoElement {
    captureStream(): MediaStream
  }
}
