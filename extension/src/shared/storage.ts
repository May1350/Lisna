import type { User } from './types'

const KEYS = {
  TOKEN: 'sh.token',
  USER: 'sh.user',
  CONSENT: 'sh.consent.v1',
  PLAYBACK: 'sh.playback',
  ENABLED: 'sh.enabled',
  AUTO_DOWNLOAD: 'sh.autoDownload',
  // First-time inline-button discovery: gates the pulsing onboarding
  // tooltip ("👈 ここをクリックで録音開始") so it only shows on the
  // user's very first encounter with a video page after install.
  // Marked true once they click the button OR after a 30 s timeout
  // so it doesn't pulse forever for users who ignore it.
  INLINE_BUTTON_SEEN: 'sh.inlineButtonSeen',
  // Obsidian Local REST API integration (v0.3). Users install the
  // community plugin in Obsidian, copy their API key, and paste it
  // here. After every curate run we PUT the markdown + slide images
  // straight into their vault via the plugin's HTTP endpoint —
  // bypassing the .zip download / drag-into-vault flow entirely.
  // All four are optional; full set must be present for sync to fire.
  OBSIDIAN_API_URL:    'sh.obsidianApiUrl',     // e.g. http://127.0.0.1:27123
  OBSIDIAN_API_KEY:    'sh.obsidianApiKey',     // bearer token from plugin settings
  OBSIDIAN_FOLDER:     'sh.obsidianFolder',     // vault-relative folder, e.g. "Lectures"
  OBSIDIAN_AUTO_SYNC:  'sh.obsidianAutoSync',   // push automatically on outline_updated
} as const

export async function getToken(): Promise<string | null> {
  const r = await chrome.storage.local.get(KEYS.TOKEN)
  return (r[KEYS.TOKEN] as string | undefined) ?? null
}
export async function setToken(t: string | null): Promise<void> {
  if (t) await chrome.storage.local.set({ [KEYS.TOKEN]: t })
  else await chrome.storage.local.remove(KEYS.TOKEN)
}

export async function getUser(): Promise<User | null> {
  const r = await chrome.storage.local.get(KEYS.USER)
  return (r[KEYS.USER] as User | undefined) ?? null
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
  return (r[KEYS.PLAYBACK] as 'auto' | number | undefined) ?? 'auto'
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

// Auto-download zip when the session ends. Default off — user has to
// explicitly opt in from the options page. When on, the modal triggers
// a `.zip` (markdown + slides) download as soon as the final curate
// completes after `video.ended`. No effect on manual export buttons.
export async function getAutoDownload(): Promise<boolean> {
  const r = await chrome.storage.local.get(KEYS.AUTO_DOWNLOAD)
  return r[KEYS.AUTO_DOWNLOAD] === true
}
export async function setAutoDownload(v: boolean): Promise<void> {
  await chrome.storage.local.set({ [KEYS.AUTO_DOWNLOAD]: v })
}

export async function hasSeenInlineButton(): Promise<boolean> {
  const r = await chrome.storage.local.get(KEYS.INLINE_BUTTON_SEEN)
  return Boolean(r[KEYS.INLINE_BUTTON_SEEN])
}
export async function markInlineButtonSeen(): Promise<void> {
  await chrome.storage.local.set({ [KEYS.INLINE_BUTTON_SEEN]: true })
}

// Obsidian Local REST API config. All four read/write together —
// the sync code requires URL + key to be present; folder defaults
// to "" (vault root) when blank; autoSync defaults to false.
export interface ObsidianConfig {
  apiUrl: string
  apiKey: string
  folder: string
  autoSync: boolean
}
export async function getObsidianConfig(): Promise<ObsidianConfig> {
  const r = await chrome.storage.local.get([
    KEYS.OBSIDIAN_API_URL,
    KEYS.OBSIDIAN_API_KEY,
    KEYS.OBSIDIAN_FOLDER,
    KEYS.OBSIDIAN_AUTO_SYNC,
  ])
  const asStr = (v: unknown): string => typeof v === 'string' ? v : ''
  return {
    apiUrl:   asStr(r[KEYS.OBSIDIAN_API_URL]),
    apiKey:   asStr(r[KEYS.OBSIDIAN_API_KEY]),
    folder:   asStr(r[KEYS.OBSIDIAN_FOLDER]),
    autoSync: r[KEYS.OBSIDIAN_AUTO_SYNC] === true,
  }
}
export async function setObsidianConfig(cfg: Partial<ObsidianConfig>): Promise<void> {
  const updates: Record<string, unknown> = {}
  if ('apiUrl'   in cfg) updates[KEYS.OBSIDIAN_API_URL]   = cfg.apiUrl   ?? ''
  if ('apiKey'   in cfg) updates[KEYS.OBSIDIAN_API_KEY]   = cfg.apiKey   ?? ''
  if ('folder'   in cfg) updates[KEYS.OBSIDIAN_FOLDER]    = cfg.folder   ?? ''
  if ('autoSync' in cfg) updates[KEYS.OBSIDIAN_AUTO_SYNC] = cfg.autoSync === true
  await chrome.storage.local.set(updates)
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
