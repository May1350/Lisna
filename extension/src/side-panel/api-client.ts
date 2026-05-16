import { WS_URL } from '../shared/config'
import type { SlideItem, User } from '../shared/types'
import { getToken } from '../shared/storage'

/** Error thrown by callApi on a non-2xx response. Preserves the parsed
 *  body and HTTP status so callers can surface structured backend
 *  signals — e.g. /v1/session/curate's 409 body
 *  `{error: 'curate_in_progress'}` lets the modal show the localised
 *  hint instead of the generic "HTTP 409: ..." fallback. */
export class ApiError extends Error {
  status?: number
  data?: unknown
  constructor(message: string, status?: number, data?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.data = data
  }
}

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
  if (!r.ok) throw new ApiError(r.error, r.status, r.data)
  return r.data as T
}

export interface LoginResult {
  user: User
  currentSession: {
    id: string
    slides: SlideItem[]
    // Curated outline for this URL. Optional + nullable so older
    // backend builds (and freshly-created sessions with no curate
    // run yet) still parse without explicit casts. Hoisted into
    // this type so callers don't need a `(x as { outline?: ... })`
    // assertion to read it.
    outline?: Outline | null
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

/**
 * Account-picker variant — same backend round-trip as `login()` but
 * forces Google's hosted account chooser via launchWebAuthFlow. Use
 * this for the "다른 Google 계정 사용" CTA on the login screen.
 */
export async function loginWithPicker(currentUrl?: string): Promise<LoginResult> {
  const r = await chrome.runtime.sendMessage({ type: 'AUTH_LOGIN_PICKER', currentUrl })
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
export type Provenance = 'transcript' | 'inferred'
export interface OutlineKeyTerm {
  term: string
  definition: string
  ts: number
  from: Provenance
}
export interface OutlineExample {
  text: string
  ts: number
  from: Provenance
}
export interface OutlinePoint {
  text: string
  ts: number
  important: boolean
  from: Provenance
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
  /** Fired when the connection is permanently gone (clean close OR
   *  reconnect attempts exhausted). Callers should stop expecting
   *  live updates and rely on HTTP-fallback paths. */
  onClose: () => void
  /** Fired when reconnection state changes. Lets the modal surface a
   *  "live updates paused" hint while the backoff is in flight. */
  onReconnect?: (state: { attempt: number; nextDelayMs: number }) => void
}

/** Handle returned by connectWs; call .close() on cleanup to stop any
 *  pending reconnect timer and fully tear down. Idempotent. */
export interface WsHandle {
  close(): void
}

// Reconnect schedule: 1 s, 2 s, 4 s, 8 s, 16 s, 30 s. After the 6th
// failed attempt we give up — at that point the backend / network is
// genuinely down and continuing to retry burns battery without
// helping. The HTTP fallback path in content/index.ts already covers
// curate-completion delivery, so a permanently-dead WS just means the
// modal misses live transcripts and slides until the user refreshes.
const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000]

export async function connectWs(sessionId: string, listeners: WsListeners): Promise<WsHandle> {
  const token = await getToken()
  const url = `${WS_URL}?token=${encodeURIComponent(token!)}&session_id=${sessionId}`

  let ws: WebSocket | null = null
  let attempt = 0
  let reconnectTimer: number | null = null
  // closed=true after the caller's .close() runs. Guards against late
  // onclose fires triggering another reconnect after teardown.
  let closed = false

  const dispatch = (e: MessageEvent): void => {
    // Any message arriving on the socket means the connection is
    // healthy — reset the backoff so the next disconnect starts from
    // attempt 0. Without this a flap would keep escalating delays
    // toward 30 s even between brief outages.
    attempt = 0
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
    } catch { /* ignore malformed frames */ }
  }

  const open = (): void => {
    if (closed) return
    const sock = new WebSocket(url)
    ws = sock
    sock.onmessage = dispatch
    // Some browsers / network conditions fire onerror without a
    // following onclose (e.g. an immediate handshake rejection).
    // Force-closing here ensures the onclose path always runs and
    // schedules the reconnect — without this the modal silently
    // falls into permanent-idle on those error variants.
    sock.onerror = () => {
      try { sock.close() } catch { /* already closing */ }
    }
    sock.onclose = (e) => {
      if (ws === sock) ws = null
      if (closed) return
      // Clean closes (1000 normal, 1001 going-away) are intentional —
      // either we asked for it or the server gracefully shut down.
      // No reconnect; surface as terminal.
      if (e.code === 1000 || e.code === 1001) {
        listeners.onClose()
        return
      }
      if (attempt >= RECONNECT_DELAYS_MS.length) {
        // Backoff exhausted. Stop trying; the user can refresh the
        // page (or close+reopen the modal) to get a fresh socket.
        listeners.onClose()
        return
      }
      const delay = RECONNECT_DELAYS_MS[attempt]
      attempt++
      listeners.onReconnect?.({ attempt, nextDelayMs: delay })
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null
        open()
      }, delay)
    }
  }

  open()
  return {
    close(): void {
      closed = true
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      // 1000 = normal closure. Tells the server (and our own onclose
      // path) this is intentional, so no reconnect is scheduled.
      try { ws?.close(1000) } catch { /* already closing */ }
      ws = null
    },
  }
}

// Note: an earlier `jumpToTimestamp` helper and a `triggerCurate` helper
// lived here. Both became dead code after Phase 6.1: timestamp jumps
// flow through window.postMessage (App.tsx onJump) directly, and the
// curator is fired by the content script's pause/end/manual handlers,
// not via this api-client. Removed in the post-review cleanup; if you
// re-introduce them, route through `callApi` for consistent SW
// auth-token handling.


// ── 2-hour trial flow ──────────────────────────────────────────────
// Endpoints land in v0.1.23; see backend/src/handlers/trial-*.ts and
// the design doc in QuotaExhaustedIdle.tsx for the full state machine.

/** Step 1: returns a Stripe Checkout (setup mode) URL. Frontend opens
 *  this in a new tab; Stripe redirects back to /trial-success?session_id=…
 *  and the extension's visibilitychange handler calls trialConfirm. */
export async function trialStart(): Promise<{ url: string; session_id: string }> {
  return await callApi<{ url: string; session_id: string }>('/v1/trial/start', 'POST')
}

/** Step 2: finalises after Stripe returns. Idempotent. */
export async function trialConfirm(sessionId: string): Promise<{ ok: true; expires_at: string; limit_secs: number }> {
  return await callApi<{ ok: true; expires_at: string; limit_secs: number }>(
    '/v1/trial/confirm', 'POST', { session_id: sessionId },
  )
}

/** End-of-trial: "가입 안함" — detaches PM, marks declined. */
export async function trialDecline(): Promise<{ ok: true }> {
  return await callApi<{ ok: true }>('/v1/trial/decline', 'POST')
}

/** End-of-trial: "Pro 가입 (원클릭)" — creates subscription using
 *  the saved payment method. Throws on card decline / 3DS / other
 *  Stripe errors so the caller can fall back to /v1/billing/checkout. */
export async function trialSubscribe(): Promise<{ ok: true; subscription_id?: string; already?: true }> {
  return await callApi<{ ok: true; subscription_id?: string; already?: true }>(
    '/v1/billing/subscribe-from-trial', 'POST',
  )
}

