import { setToken, setUser, getToken } from '../shared/storage'
import type { User, SlideItem } from '../shared/types'
import { API_BASE_URL, WEB_OAUTH_CLIENT_ID } from '../shared/config'
// Shared wire schema — backend handler at /v1/auth/google parses the
// SAME zod schema this type derives from. Any field rename on either
// side trips a compile error here, not a runtime 400.
import type { AuthGoogleBody } from 'shared'

// Outline shape mirrors backend/src/lib/curator.ts. Inline rather than imported
// because the extension build doesn't pull from the backend tree.
interface OutlineShape {
  title: string
  sections: Array<{
    heading: string
    ts: number
    summary: string
    key_terms: Array<{ term: string; definition: string; ts: number }>
    examples: Array<{ text: string; ts: number }>
    points: Array<{ text: string; ts: number; important: boolean }>
  }>
}

// chrome.identity.getAuthToken returns an OAuth ACCESS token (not an ID token).
// We need an ID token for the backend's verifyGoogleIdToken (Google's tokeninfo
// only verifies ID tokens with proper aud/exp/sig). Path:
//   1. getAuthToken({interactive:true}) → access token (silent if user is
//      already signed into Chrome with a Google account; ~0 s vs ~5 s for
//      launchWebAuthFlow's popup).
//   2. Exchange access token for ID token via Google's userinfo endpoint —
//      actually that returns profile, not an ID token. For ID tokens we use
//      a separate launchWebAuthFlow with id_token response_type, OR we use
//      the userinfo profile and trust that the access token grants this
//      identity. We pick the latter: send the access token to the backend
//      and have the backend call userinfo to verify.
//
// Net: the user-facing flow drops from "popup → consent → redirect" (~5 s)
// to "instant token return" (~0.2 s) for users already signed into Chrome.

export interface LoginResult {
  user: User
  currentSession: {
    id: string
    slides: SlideItem[]
    outline: OutlineShape | null
    // ISO 8601 timestamp from sessions.updated_at — the actual last
    // time the outline (or any session field) was modified server-
    // side. Drives the modal's "X分前" indicator instead of the
    // modal-open time. Optional for backward compatibility with
    // older backend deploys that don't include the field.
    updated_at?: string
    // Legacy `notes` field is still in the backend response shape but
    // unused since Phase 6.1 — see api-client.ts for the rationale.
  } | null
}

function tryGetAuthToken(interactive: boolean): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      // Silent failure ≠ error; just means we need interactive.
      if (chrome.runtime.lastError || !token) return resolve(null)
      resolve(typeof token === 'string' ? token : (token as { token: string }).token)
    })
  })
}

async function getGoogleAccessToken(): Promise<string> {
  // Two-stage: silent first, then interactive only if needed. The silent
  // call returns immediately when Chrome already has a cached, unexpired
  // access token for our OAuth client — which is the common case once the
  // user has consented at least once on this device. Skipping straight to
  // interactive: true would force Chrome to repaint the consent UI even
  // when the cached token would have worked.
  const cached = await tryGetAuthToken(false)
  if (cached) return cached
  const fresh = await tryGetAuthToken(true)
  if (!fresh) throw new Error('Google sign-in cancelled or failed')
  return fresh
}

/** Optional: pass currentUrl so the backend hydrates an existing session in
 * the same response — saves a separate /v1/session round-trip on the modal. */
export async function loginWithGoogle(currentUrl?: string): Promise<LoginResult> {
  const accessToken = await getGoogleAccessToken()

  const body = {
    access_token: accessToken,
    ...(currentUrl ? { current_url: currentUrl } : {}),
  } satisfies AuthGoogleBody
  const r = await fetch(`${API_BASE_URL}/v1/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) {
    // Surface the backend's structured `{error: "..."}` reason instead
    // of showing only the HTTP status. The user-facing LoginScreen
    // takes whatever Error.message we throw and renders it as the
    // failure label; "login failed: 400" alone gave operators nothing
    // to diagnose with. Best-effort body parse — fall back to status
    // if the response isn't JSON or doesn't carry an error field.
    let detail = ''
    try {
      const body = await r.text()
      if (body) {
        try {
          const parsed = JSON.parse(body) as { error?: unknown }
          if (typeof parsed.error === 'string' && parsed.error) detail = parsed.error
        } catch { detail = body.slice(0, 200) }
      }
    } catch { /* response already consumed; ignore */ }
    throw new Error(`login failed: ${r.status}${detail ? ` — ${detail}` : ''}`)
  }
  const data = await r.json() as {
    token: string
    user: User
    currentSession: {
      id: string
      slides: SlideItem[]
      outline: OutlineShape | null
      updated_at?: string
    } | null
  }
  await setToken(data.token)
  await setUser(data.user)
  return { user: data.user, currentSession: data.currentSession }
}

/**
 * Per-user-state storage keys cleared on logout. The token/user pair
 * was already cleared by the previous logout(); cachedQuota +
 * pendingTrialSession are the two derived items that would otherwise
 * outlive the auth state and pollute the next user's first paint:
 *  - cachedQuota: a stale quota seed for the previous user would
 *    flash on cold mount before /v1/auth/me lands for the new user.
 *  - pendingTrialSession: a stale trial-confirm pointer would fire
 *    a useless trialConfirm under the new user's JWT (rejected by
 *    backend but logs noise + confuses).
 */
const PER_USER_STORAGE_KEYS = [
  'sh.token',
  'sh.user',
  'sh.cachedQuota',
  'sh.pendingTrialSession',
] as const

export async function logout(): Promise<void> {
  await chrome.storage.local.remove([...PER_USER_STORAGE_KEYS])
}

/**
 * Hard reset for "switch Google account". Clears the backend session
 * AND every cached OAuth token Chrome holds for this extension. Without
 * the cache wipe, the next getAuthToken({interactive:false}) silently
 * returns whichever Google account Chrome is signed into → the user
 * lands right back on the same account they wanted to leave.
 *
 * After this call, the next loginWithGoogle() will go through
 * getAuthToken({interactive:true}). For Chrome profiles with multiple
 * Google accounts added (Add another account), this surfaces the
 * account picker. For single-account Chrome profiles, the picker
 * silently re-grabs the same account — use `loginWithGoogleAccountPicker`
 * below (launchWebAuthFlow with prompt=select_account) for the case
 * where the user wants to authenticate against an account NOT in
 * their Chrome profile.
 */
export async function switchAccount(): Promise<void> {
  await chrome.storage.local.remove([...PER_USER_STORAGE_KEYS])
  await new Promise<void>((resolve) => {
    chrome.identity.clearAllCachedAuthTokens(() => {
      // We intentionally don't surface chrome.runtime.lastError here —
      // a missing-cache error is benign and means we're already in the
      // desired clean state.
      resolve()
    })
  })
}

/**
 * Authenticate with Google by launching Google's hosted account
 * chooser via `chrome.identity.launchWebAuthFlow`. Unlike
 * `loginWithGoogle()` which uses the Chrome-extension OAuth client
 * + Chrome's native account picker (limited to accounts already
 * linked in the Chrome profile), this path uses the WEB OAuth client
 * + `prompt=select_account`, so the user can authenticate against
 * ANY Google account — including one not currently in their Chrome.
 *
 * Backend's GOOGLE_OAUTH_CLIENT_ID secret accepts both client_ids
 * (comma-separated list, checked via set-membership in
 * verifyGoogleAccessToken), so the resulting JWT issuance path is
 * identical to `loginWithGoogle()`.
 *
 * Requires GCP config: the redirect URI returned by
 * `chrome.identity.getRedirectURL()` must be registered in the WEB
 * OAuth client's "Authorized redirect URIs". Without it the flow
 * fails with `redirect_uri_mismatch` before the user sees the picker.
 */
export async function loginWithGoogleAccountPicker(currentUrl?: string): Promise<LoginResult> {
  if (!WEB_OAUTH_CLIENT_ID) {
    throw new Error(
      'Account picker not available: VITE_GOOGLE_OAUTH_CLIENT_ID is unset. ' +
      'Ensure extension/.env.production has the value (or .env.development for dev builds).',
    )
  }

  const redirectUri = chrome.identity.getRedirectURL()
  // Nonce echoed back through the OAuth redirect so we can verify the
  // response came from the same auth request we initiated. With
  // launchWebAuthFlow's same-origin redirect (only OUR chromiumapp.org
  // URL accepts the redirect), the realistic attack surface is small,
  // but echoing a server-generated nonce is the standard OAuth
  // implicit-flow safeguard and lets us reject any mismatched callback
  // immediately rather than blindly trusting the fragment.
  const state = crypto.randomUUID()
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  authUrl.searchParams.set('response_type', 'token')
  authUrl.searchParams.set('client_id', WEB_OAUTH_CLIENT_ID)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('scope', 'openid email profile')
  authUrl.searchParams.set('prompt', 'select_account')
  authUrl.searchParams.set('state', state)

  // chrome.runtime.lastError is only readable inside the callback —
  // capture its message synchronously so the outer error branch can
  // include it in the thrown message and the diagnostic log.
  const flowResult = await new Promise<
    { ok: true; redirectedTo: string } | { ok: false; lastError: string | null }
  >((resolve) => {
    chrome.identity.launchWebAuthFlow(
      { url: authUrl.toString(), interactive: true },
      (redirectedTo) => {
        const lastErr = chrome.runtime.lastError?.message ?? null
        if (lastErr || !redirectedTo) return resolve({ ok: false, lastError: lastErr })
        resolve({ ok: true, redirectedTo })
      },
    )
  })
  if (!flowResult.ok) {
    // Most common cause is a user-cancelled popup, but it ALSO covers
    // `redirect_uri_mismatch` (Google's 400 page never resolves to a
    // redirect, so Chrome reports the same "User did not approve access"
    // lastError on close — JS cannot distinguish the two cases). Use
    // console.warn (not error) so a routine user cancel doesn't paint
    // a red entry in the SW console; the diagnostic payload is still
    // discoverable via chrome://extensions → service worker → Inspect.
    // An operator chasing redirect_uri_mismatch can compare extensionId
    // / redirectUri / webClientId against GCP's "Authorized redirect
    // URIs" list at a glance.
    console.warn('[loginWithGoogleAccountPicker] launchWebAuthFlow failed', {
      lastError: flowResult.lastError,
      extensionId: chrome.runtime.id,
      redirectUri,
      webClientId: WEB_OAUTH_CLIENT_ID,
    })
    throw new Error(
      flowResult.lastError
        ? `Account picker failed: ${flowResult.lastError}`
        : 'Account picker cancelled or failed',
    )
  }
  const redirectResult = flowResult.redirectedTo

  // Token + state arrive in the URL fragment (implicit flow). Google
  // surfaces a user-cancelled-consent as `?error=access_denied` in the
  // query string (per RFC 6749 §4.2.2.1) — parse that first so the
  // user sees "access_denied" instead of the misleading "no
  // access_token" fallback further down.
  const redirectUrl = new URL(redirectResult)
  const hashParams = new URLSearchParams(redirectUrl.hash.slice(1))
  const errFromGoogle = redirectUrl.searchParams.get('error') ?? hashParams.get('error')
  if (errFromGoogle) {
    throw new Error(`Account picker error: ${errFromGoogle}`)
  }
  const returnedState = hashParams.get('state')
  if (returnedState !== state) {
    throw new Error('Account picker state mismatch')
  }
  const accessToken = hashParams.get('access_token')
  if (!accessToken) {
    throw new Error('Account picker returned no access_token')
  }

  // Same backend round-trip as loginWithGoogle — backend's
  // verifyGoogleAccessToken handles the comma-separated aud check
  // for both Chrome-ext + Web client tokens identically.
  const r = await fetch(`${API_BASE_URL}/v1/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      access_token: accessToken,
      ...(currentUrl ? { current_url: currentUrl } : {}),
    }),
  })
  if (!r.ok) {
    let detail = ''
    try {
      const body = await r.text()
      if (body) {
        try {
          const parsed = JSON.parse(body) as { error?: unknown }
          if (typeof parsed.error === 'string' && parsed.error) detail = parsed.error
        } catch { detail = body.slice(0, 200) }
      }
    } catch { /* ignore */ }
    throw new Error(`login failed: ${r.status}${detail ? ` — ${detail}` : ''}`)
  }
  const data = await r.json() as {
    token: string
    user: User
    currentSession: {
      id: string
      slides: SlideItem[]
      outline: OutlineShape | null
      updated_at?: string
    } | null
  }
  await setToken(data.token)
  await setUser(data.user)
  return { user: data.user, currentSession: data.currentSession }
}

export async function authedFetch(
  path: string,
  init: RequestInit = {},
  absoluteUrl?: string,
): Promise<Response> {
  const token = await getToken()
  const headers = new Headers(init.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  // When the caller passes a full URL we use it verbatim — needed for
  // Lambda Function URLs (e.g. /v1/session/curate) that live outside
  // API Gateway. Otherwise prepend API_BASE_URL to the path as before.
  const url = absoluteUrl || `${API_BASE_URL}${path}`
  return fetch(url, { ...init, headers })
}
