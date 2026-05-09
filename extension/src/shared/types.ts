export interface User {
  id: string
  email: string
  name?: string
  plan: 'free' | 'pro'
}

export interface SlideItem {
  ts: number
  key: string
  url: string
}

export type SwRequest =
  | { type: 'AUTH_LOGIN'; currentUrl?: string }
  | { type: 'AUTH_LOGOUT' }
  // Logout + clear Chrome's cached OAuth tokens. Required for "switch
  // Google account" UX — without clearing the cache, the next
  // getAuthToken({interactive:false}) silently returns the same account
  // and the user can't actually switch.
  | { type: 'AUTH_SWITCH_ACCOUNT' }
  // From the in-page modal header — opens the Chrome side panel for
  // the active window so the user can check past lectures (history)
  // without leaving the video page. SW resolves the windowId + calls
  // chrome.sidePanel.open which requires a user gesture; the gesture
  // is preserved through chrome.runtime.sendMessage on Chrome 116+.
  | { type: 'OPEN_SIDE_PANEL' }
  // Surfaces the Options page Feedback form from any extension context.
  // Used by error-banner CTAs in App.tsx that have already written a
  // prefill via shared/feedback-prefill.ts.
  | { type: 'OPEN_OPTIONS_PAGE' }
  | { type: 'AUTH_GET_USER' }
  // Quick-disable from the inline button's × affordance. SW sets
  // sh.enabled=false + sh.disabledUntil=now+durationHours and creates a
  // chrome.alarm that re-enables when the timer expires. Manual ON in
  // the side panel cancels the alarm.
  | { type: 'DISABLE_TEMPORARILY' }
  // path is appended to API_BASE_URL by default. When `absoluteUrl` is
  // set the SW fetches that URL directly instead — used to call the
  // Lambda Function URL for /v1/session/curate (bypasses API Gateway's
  // 30 s integration timeout).
  | { type: 'API_FETCH'; path: string; method: string; body?: unknown; absoluteUrl?: string }
  // Side-panel ON/OFF switch flips global enable state, badge, and content scripts.
  | { type: 'TOGGLE_ENABLED'; enabled: boolean }
  | { type: 'STOP_SESSION'; tabId: number }
  // Side-panel timestamp-jump entry point. The SW forwards this to the
  // active tab's content script as { type: 'JUMP_TO', ts } via
  // chrome.tabs.sendMessage. The content script there handles the actual
  // video.currentTime mutation (cross-frame routing if the video lives
  // in a child iframe).
  | { type: 'JUMP_TO_REQUEST'; ts: number }
  // Lambda warmup ping — fired from SW startup + content script video page entry
  // to pay the cold-start cost before the user actually clicks anything.
  | { type: 'WARMUP' }

export type SwResponse =
  | { ok: true; data: unknown }
  // On API_FETCH failures we still forward the HTTP status + parsed body so
  // callers can recover structured fields (e.g. the quota snapshot embedded
  // in a 402 quota_exceeded). Both fields are optional because non-fetch
  // handlers don't have them.
  | { ok: false; error: string; status?: number; data?: unknown }

// Quota snapshot returned by /v1/stream/audio (success and 402 paths).
// Mirrors backend/src/handlers/stream-audio.ts's quotaSnapshot literal.
export interface QuotaSnapshot {
  used_secs: number
  limit_secs: number
  remaining_secs: number
  percent_used: number
  plan: 'free' | 'pro'
}

// Augment HTMLVideoElement to include captureStream (not yet in lib.dom standard typings everywhere).
declare global {
  interface HTMLVideoElement {
    captureStream(): MediaStream
  }
}
