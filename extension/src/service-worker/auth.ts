import { setToken, setUser, getToken } from '../shared/storage'
import type { User, NoteItem, SlideItem } from '../shared/types'
import { API_BASE_URL } from '../shared/config'

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
  currentSession: { id: string; notes: NoteItem[]; slides: SlideItem[] } | null
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

  const r = await fetch(`${API_BASE_URL}/v1/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      access_token: accessToken,
      ...(currentUrl ? { current_url: currentUrl } : {}),
    }),
  })
  if (!r.ok) throw new Error('login failed: ' + r.status)
  const data = await r.json() as {
    token: string
    user: User
    currentSession: { id: string; notes: NoteItem[]; slides: SlideItem[] } | null
  }
  await setToken(data.token)
  await setUser(data.user)
  return { user: data.user, currentSession: data.currentSession }
}

export async function logout(): Promise<void> {
  await setToken(null)
  await setUser(null)
}

export async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getToken()
  const headers = new Headers(init.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  return fetch(`${API_BASE_URL}${path}`, { ...init, headers })
}
