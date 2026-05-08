import { useEffect, useState } from 'react'
import type { LanguageCode, NoteLanguageCode, Translations } from './types'
import { ja } from './ja'
import { en } from './en'
import { ko } from './ko'
import { zh } from './zh'

// ──────────────────────────────────────────────────────────────────────
// Custom lightweight i18n. Why not chrome.i18n / react-i18next?
//   - chrome.i18n forces the browser locale on us; we need user-
//     selectable language regardless of browser settings.
//   - react-i18next adds 30-50 KB and most of its features (plurals,
//     namespaces, lazy loading) we don't actually need.
//   - Our string set is ~150 keys × 4 locales — fits comfortably in
//     under 50 KB inline. Custom is cheap and removes a dependency.
//
// Public API:
//   • t()                     — returns the current locale's full
//                                Translations object. Components do
//                                e.g. t().controls.pause.
//   • useT()                  — same as t(), but a React hook that
//                                re-renders the component on language
//                                change. Use this from any TSX.
//   • setLang(code)           — switches the active locale, persists
//                                to chrome.storage, and notifies all
//                                useT() subscribers immediately.
//   • getLang() / getNoteLang — current values
//   • setNoteLang             — persist note generation preference
//   • detectLanguage()        — best-effort initial pick from browser
//   • interpolate(s, params)  — fills {placeholder} tokens
//   • bootstrap()             — call once at app start to hydrate
//                                state from storage / browser detection

const TRANSLATIONS: Record<LanguageCode, Translations> = { ja, en, ko, zh }

const SYSTEM_LANG_KEY = 'sh.systemLang'
const NOTE_LANG_KEY = 'sh.noteLang'

let currentLang: LanguageCode = 'ja'
let currentNoteLang: NoteLanguageCode = 'auto'
const subscribers = new Set<() => void>()

function notify(): void {
  for (const cb of subscribers) {
    try { cb() } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[i18n] subscriber threw', e)
    }
  }
}

export function t(): Translations {
  return TRANSLATIONS[currentLang]
}

export function getLang(): LanguageCode { return currentLang }
export function getNoteLang(): NoteLanguageCode { return currentNoteLang }

export async function setLang(lang: LanguageCode): Promise<void> {
  if (lang === currentLang) return
  currentLang = lang
  await chrome.storage.local.set({ [SYSTEM_LANG_KEY]: lang })
  notify()
}

export async function setNoteLang(lang: NoteLanguageCode): Promise<void> {
  if (lang === currentNoteLang) return
  currentNoteLang = lang
  await chrome.storage.local.set({ [NOTE_LANG_KEY]: lang })
  // No notify() — note language doesn't affect UI strings, only
  // backend curator output. UI doesn't need to re-render.
}

// Detect from browser. Coarse mapping: any ja-* → ja, any ko-* → ko,
// any zh-* → zh, everything else → en. This is the FIRST-INSTALL
// default; user override via Options always wins after that.
export function detectLanguage(): LanguageCode {
  const nav = (typeof navigator !== 'undefined' ? navigator.language : '').toLowerCase()
  if (nav.startsWith('ja')) return 'ja'
  if (nav.startsWith('ko')) return 'ko'
  if (nav.startsWith('zh')) return 'zh'
  return 'en'
}

// Read persisted language from chrome.storage and seed the in-memory
// values. Idempotent — safe to call multiple times. Components that
// render before bootstrap completes use the module-level defaults
// (ja for system, auto for note); the first useT() re-render after
// bootstrap picks up the persisted value.
export async function bootstrap(): Promise<void> {
  try {
    const r = await chrome.storage.local.get([SYSTEM_LANG_KEY, NOTE_LANG_KEY])
    const stored = r[SYSTEM_LANG_KEY]
    if (stored === 'ja' || stored === 'en' || stored === 'ko' || stored === 'zh') {
      currentLang = stored
    } else {
      // First install → derive from navigator and persist so future
      // app loads don't re-detect (user might have changed locale).
      currentLang = detectLanguage()
      await chrome.storage.local.set({ [SYSTEM_LANG_KEY]: currentLang })
    }
    const noteStored = r[NOTE_LANG_KEY]
    if (noteStored === 'auto' || noteStored === 'ja' || noteStored === 'en' || noteStored === 'ko' || noteStored === 'zh') {
      currentNoteLang = noteStored
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[i18n] bootstrap failed, using defaults', e)
  }
  notify()
}

// React hook. Subscribes to language changes; component re-renders
// the moment setLang() is called from anywhere.
export function useT(): Translations {
  const [, force] = useState(0)
  useEffect(() => {
    const cb = () => force(n => n + 1)
    subscribers.add(cb)
    return () => { subscribers.delete(cb) }
  }, [])
  return TRANSLATIONS[currentLang]
}

// Cross-tab / cross-context sync. The Options page lives in a
// separate top-level window from the modal iframe; without this
// listener, changing language in Options wouldn't immediately update
// an open modal. chrome.storage events broadcast to all extension
// contexts.
if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return
    const lc = changes[SYSTEM_LANG_KEY]
    if (lc && (lc.newValue === 'ja' || lc.newValue === 'en' || lc.newValue === 'ko' || lc.newValue === 'zh')) {
      if (lc.newValue !== currentLang) {
        currentLang = lc.newValue
        notify()
      }
    }
    const nc = changes[NOTE_LANG_KEY]
    if (nc) {
      const v = nc.newValue
      if (v === 'auto' || v === 'ja' || v === 'en' || v === 'ko' || v === 'zh') {
        currentNoteLang = v
      }
    }
  })
}

// Replace {placeholder} tokens in a translation string. Designed for
// the small set of variable-substitution cases (slide count, time,
// path preview). Leaves unknown tokens intact rather than failing —
// missing values surface as visible "{n}" in the UI which is easy
// to spot during review.
export function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (m, key) => {
    const v = params[key]
    return v === undefined || v === null ? m : String(v)
  })
}

export type { Translations, LanguageCode, NoteLanguageCode }
