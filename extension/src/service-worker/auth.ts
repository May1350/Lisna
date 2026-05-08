import { setToken, setUser, getToken } from '../shared/storage'
import type { User, SlideItem } from '../shared/types'
import { API_BASE_URL } from '../shared/config'

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
    currentSession: {
      id: string
      slides: SlideItem[]
      outline: OutlineShape | null
    } | null
  }
  await setToken(data.token)
  await setUser(data.user)
  return { user: data.user, currentSession: data.currentSession }
}

export async function logout(): Promise<void> {
  await setToken(null)
  await setUser(null)
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
