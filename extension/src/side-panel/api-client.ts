import { WS_URL } from '../shared/config'
import type { SlideItem, User } from '../shared/types'
import { getToken } from '../shared/storage'

export async function callApi<T = unknown>(
  path: string,
  method: string,
  body?: unknown,
  options: { absoluteUrl?: string } = {},
): Promise<T> {
  const r = await chrome.runtime.sendMessage({
    type: 'API_FETCH',
    path,
    method,
    body,
    absoluteUrl: options.absoluteUrl,
  })
  if (!r.ok) throw new Error(r.error)
  return r.data as T
}

export interface LoginResult {
  user: User
  currentSession: {
    id: string
    slides: SlideItem[]
    outline: Outline | null
    // ISO 8601 last-update timestamp from the DB. Used to show the
    // real "X分前" on the outline indicator when the modal hydrates
    // a previously-curated session. Optional so older backend
    // builds that don't include the field still parse.
    updated_at?: string
    // Note: backend still returns `notes` (legacy per-chunk bullets)
    // but the modal no longer renders them — Phase 6.1 made the
    // outline the single source of truth. Field omitted here so it
    // can't be accidentally consumed.
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

// =============================================================
// Outline types — mirror of backend/src/lib/curator.ts.
// SOURCE OF TRUTH: backend/src/lib/curator.ts (Outline*).
// Keep these two definitions in sync when adding fields. The
// alternative (a shared workspace package) is overkill while the
// shape is small; revisit if drift becomes a recurring source of
// bugs (see CLAUDE.md for the prior drift incident where Phase 6
// fields landed in backend without making it here, forcing
// `as` casts in OutlineView.tsx).
// =============================================================
export interface OutlineKeyTerm {
  term: string
  definition: string
  ts: number
}
export interface OutlineExample {
  text: string
  ts: number
}
export interface OutlinePoint {
  text: string
  ts: number
  important: boolean
}
export interface OutlineSection {
  heading: string
  ts: number
  summary: string
  key_terms: OutlineKeyTerm[]
  examples: OutlineExample[]
  points: OutlinePoint[]
  // Phase 6 (Obsidian-aware) additions — all optional so legacy
  // outlines (stored in DB without these fields) still parse.
  related_terms?: string[]
  takeaway?: string
  check_question?: string
}
export interface Outline {
  title: string
  sections: OutlineSection[]
  // Phase 6 (Obsidian-aware) — all optional, legacy outlines may omit.
  course?: string
  lecturer?: string
  tldr?: string
  related_lectures?: string[]
}

export interface WsListeners {
  onSlide: (slide: SlideItem) => void
  /** Receives one OR more transcript items per WS message. The backend
   *  bundles all sub-chunk segments from a 10 s audio chunk into a
   *  single message, so callers should append all items in order. */
  onTranscript: (items: LiveTranscriptItem[]) => void
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
      if (msg.type === 'transcript_chunk') {
        // Newer backend builds emit `items: [{ts, text}, ...]` so the
        // 10 s audio chunk's sub-chunk Whisper segments all land in one
        // message. Older builds (or fallback paths) emit just `ts`+
        // `text` for a single chunk-level entry. Handle both.
        if (Array.isArray(msg.items) && msg.items.length > 0) {
          listeners.onTranscript(
            (msg.items as { ts: number; text: string }[])
              .map(it => ({ ts: it.ts, text: it.text })),
          )
        } else if (typeof msg.ts === 'number' && typeof msg.text === 'string') {
          listeners.onTranscript([{ ts: msg.ts, text: msg.text }])
        }
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

// Note: an earlier `jumpToTimestamp` helper and a `triggerCurate` helper
// lived here. Both became dead code after Phase 6.1: timestamp jumps
// flow through window.postMessage (App.tsx onJump) directly, and the
// curator is fired by the content script's pause/end/manual handlers,
// not via this api-client. Removed in the post-review cleanup; if you
// re-introduce them, route through `callApi` for consistent SW
// auth-token handling.
