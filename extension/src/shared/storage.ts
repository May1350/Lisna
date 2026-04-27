import type { User } from './types'

const KEYS = {
  TOKEN: 'sh.token',
  USER: 'sh.user',
  CONSENT: 'sh.consent.v1',
  PLAYBACK: 'sh.playback',
  ENABLED: 'sh.enabled',
} as const

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

export async function getEnabled(): Promise<boolean> {
  const r = await chrome.storage.local.get(KEYS.ENABLED)
  return r[KEYS.ENABLED] !== false   // default true
}
export async function setEnabled(v: boolean): Promise<void> {
  await chrome.storage.local.set({ [KEYS.ENABLED]: v })
}

/**
 * Subscribe to changes of the `sh.enabled` flag (any source: this script,
 * the side panel, the options page, etc). Returns an unsubscribe function.
 */
export function onEnabledChange(callback: (enabled: boolean) => void): () => void {
  const listener = (
    changes: { [key: string]: chrome.storage.StorageChange },
    area: chrome.storage.AreaName,
  ) => {
    if (area !== 'local') return
    const c = changes[KEYS.ENABLED]
    if (!c) return
    callback(c.newValue !== false)
  }
  chrome.storage.onChanged.addListener(listener)
  return () => chrome.storage.onChanged.removeListener(listener)
}

export const STORAGE_KEYS = KEYS
