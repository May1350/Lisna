import { setToken, setUser, getToken } from '../shared/storage'
import type { User } from '../shared/types'
import { API_BASE_URL } from '../shared/config'

const CLIENT_ID = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID

export async function loginWithGoogle(): Promise<User> {
  const idToken = await new Promise<string>((resolve, reject) => {
    const redirectUri = chrome.identity.getRedirectURL('oauth2')
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    url.searchParams.set('client_id', CLIENT_ID)
    url.searchParams.set('response_type', 'id_token')
    url.searchParams.set('scope', 'openid email profile')
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('nonce', crypto.randomUUID())
    chrome.identity.launchWebAuthFlow({ url: url.toString(), interactive: true }, (resp) => {
      if (chrome.runtime.lastError || !resp) return reject(chrome.runtime.lastError)
      const fragment = new URL(resp).hash.slice(1)
      const token = new URLSearchParams(fragment).get('id_token')
      if (!token) return reject(new Error('no id_token'))
      resolve(token)
    })
  })

  const r = await fetch(`${API_BASE_URL}/v1/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id_token: idToken }),
  })
  if (!r.ok) throw new Error('login failed: ' + r.status)
  const data = await r.json() as { token: string; user: User }
  await setToken(data.token)
  await setUser(data.user)
  return data.user
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
