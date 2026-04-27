import type { User } from './types'

const KEYS = {
  TOKEN: 'sh.token',
  USER: 'sh.user',
  CONSENT: 'sh.consent.v1',
  PLAYBACK: 'sh.playback',
  SESSION_INDEX: 'sh.sessionIndex',
  ENABLED: 'sh.enabled',
  DISPLAY_MODE: 'sh.displayMode',
} as const

export type DisplayMode = 'side-panel' | 'popout'

export async function getToken(): Promise<string | null> {
  const r = await chrome.storage.local.get(KEYS.TOKEN)
  return r[KEYS.TOKEN] ?? null
}
export async function setToken(t: string | null): Promise<void> {
  if (t) await chrome.storage.local.set({ [KEYS.TOKEN]: t })
  else await chrome.storage.local.remove(KEYS.TOKEN)
}

export async function getUser(): Promise<User | null> {
  const r = await chrome.storage.local.get(KEYS.USER)
  return r[KEYS.USER] ?? null
}
export async function setUser(u: User | null): Promise<void> {
  if (u) await chrome.storage.local.set({ [KEYS.USER]: u })
  else await chrome.storage.local.remove(KEYS.USER)
}

export async function hasConsent(): Promise<boolean> {
  const r = await chrome.storage.local.get(KEYS.CONSENT)
  return Boolean(r[KEYS.CONSENT])
}
export async function setConsent(): Promise<void> {
  await chrome.storage.local.set({ [KEYS.CONSENT]: { acceptedAt: Date.now() } })
}

export async function getPlaybackSpeed(): Promise<'auto' | number> {
  const r = await chrome.storage.local.get(KEYS.PLAYBACK)
  return r[KEYS.PLAYBACK] ?? 'auto'
}
export async function setPlaybackSpeed(v: 'auto' | number): Promise<void> {
  await chrome.storage.local.set({ [KEYS.PLAYBACK]: v })
}

export async function rememberSession(url: string, sessionId: string): Promise<void> {
  const r = await chrome.storage.local.get(KEYS.SESSION_INDEX)
  const idx: Record<string, string> = r[KEYS.SESSION_INDEX] ?? {}
  idx[url] = sessionId
  await chrome.storage.local.set({ [KEYS.SESSION_INDEX]: idx })
}
export async function lookupSession(url: string): Promise<string | null> {
  const r = await chrome.storage.local.get(KEYS.SESSION_INDEX)
  return r[KEYS.SESSION_INDEX]?.[url] ?? null
}

export async function getEnabled(): Promise<boolean> {
  const r = await chrome.storage.local.get(KEYS.ENABLED)
  return r[KEYS.ENABLED] !== false   // default true
}
export async function setEnabled(v: boolean): Promise<void> {
  await chrome.storage.local.set({ [KEYS.ENABLED]: v })
}

export async function getDisplayMode(): Promise<DisplayMode> {
  const r = await chrome.storage.local.get(KEYS.DISPLAY_MODE)
  return (r[KEYS.DISPLAY_MODE] as DisplayMode | undefined) ?? 'side-panel'
}
export async function setDisplayMode(v: DisplayMode): Promise<void> {
  await chrome.storage.local.set({ [KEYS.DISPLAY_MODE]: v })
}

export const STORAGE_KEYS = KEYS
