import type { SwRequest, SwResponse } from '../shared/types'
import { loginWithGoogle, logout, authedFetch } from './auth'
import { getUser, setEnabled } from '../shared/storage'
import { updateBadge, broadcastEnabledChange } from './notify'

const POPOUT_WIDTH = 380
const POPOUT_HEIGHT = 800

// Track popout window IDs per source-tab so we can refocus instead of double-opening.
const popoutsByTab = new Map<number, number>()

async function openPopout(tabId: number): Promise<void> {
  // If we already have a popout for this tab, focus it instead of creating a new one.
  const existing = popoutsByTab.get(tabId)
  if (existing !== undefined) {
    try {
      await chrome.windows.update(existing, { focused: true })
      return
    } catch {
      popoutsByTab.delete(tabId)
    }
  }
  const url = chrome.runtime.getURL(`src/side-panel/index.html?tabId=${tabId}`)
  // type:'popup' is more predictable cross-platform (especially macOS) than
  // 'panel', which falls back unpredictably on some platforms.
  const win = await chrome.windows.create({
    url,
    type: 'popup',
    width: POPOUT_WIDTH,
    height: POPOUT_HEIGHT,
    focused: true,
  })
  if (win?.id !== undefined) popoutsByTab.set(tabId, win.id)
}

// Keep popout map in sync if the user closes the popout window manually.
chrome.windows?.onRemoved.addListener((winId) => {
  for (const [tabId, id] of popoutsByTab.entries()) {
    if (id === winId) popoutsByTab.delete(tabId)
  }
})

export async function handle(req: SwRequest, sender?: chrome.runtime.MessageSender): Promise<SwResponse> {
  try {
    switch (req.type) {
      case 'AUTH_LOGIN': {
        const u = await loginWithGoogle()
        return { ok: true, data: u }
      }
      case 'AUTH_LOGOUT': {
        await logout()
        return { ok: true, data: null }
      }
      case 'AUTH_GET_USER': {
        const u = await getUser()
        return { ok: true, data: u }
      }
      case 'API_FETCH': {
        const r = await authedFetch(req.path, {
          method: req.method,
          body: req.body ? JSON.stringify(req.body) : undefined,
        })
        const text = await r.text()
        let parsed: unknown
        try { parsed = JSON.parse(text) } catch { parsed = text }
        if (!r.ok) return { ok: false, error: `HTTP ${r.status}: ${text}` }
        return { ok: true, data: parsed }
      }
      case 'SESSION_START': {
        // Sessions always live in a popout window (chrome.windows.create works
        // without a user gesture; chrome.sidePanel.open does NOT).
        await openPopout(req.tabId)
        try { await chrome.tabs.sendMessage(req.tabId, { type: 'SESSION_START', url: req.url }) } catch { /* ignore */ }
        return { ok: true, data: null }
      }
      case 'OPEN_VIEW': {
        // Triggered by the inline 📚 button on a video. Always popout.
        const tabId = req.tabId ?? sender?.tab?.id
        if (tabId === undefined) return { ok: false, error: 'no tabId' }
        await openPopout(tabId)
        return { ok: true, data: null }
      }
      case 'TOGGLE_ENABLED': {
        // Sent from the side-panel ON/OFF switch.
        await setEnabled(req.enabled)
        await updateBadge(req.enabled)
        await broadcastEnabledChange(req.enabled)
        return { ok: true, data: null }
      }
      case 'STOP_SESSION': {
        try {
          await chrome.tabs.sendMessage(req.tabId, { type: 'STOP_SESSION' })
        } catch {
          // tab may have navigated away; not fatal
        }
        return { ok: true, data: null }
      }
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' }
  }
  return { ok: false, error: 'unhandled message type' }
}
