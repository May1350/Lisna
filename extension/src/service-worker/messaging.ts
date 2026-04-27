import type { SwRequest, SwResponse } from '../shared/types'
import { loginWithGoogle, logout, authedFetch } from './auth'
import { getUser, getDisplayMode, setDisplayMode } from '../shared/storage'

const POPOUT_WIDTH = 380
const POPOUT_HEIGHT = 800

// Track popout window IDs per source-tab so we can close/refocus them.
const popoutsByTab = new Map<number, number>()

async function openSidePanel(tabId: number): Promise<void> {
  await chrome.sidePanel.setOptions({ tabId, path: 'src/side-panel/index.html', enabled: true })
  await chrome.sidePanel.open({ tabId })
}

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
  const win = await chrome.windows.create({
    url,
    type: 'panel',
    width: POPOUT_WIDTH,
    height: POPOUT_HEIGHT,
    focused: true,
  })
  if (win?.id !== undefined) popoutsByTab.set(tabId, win.id)
}

async function closePopoutForTab(tabId: number): Promise<void> {
  const winId = popoutsByTab.get(tabId)
  if (winId === undefined) return
  popoutsByTab.delete(tabId)
  try { await chrome.windows.remove(winId) } catch { /* already gone */ }
}

// Keep popout map in sync if the user closes the popout window manually.
chrome.windows?.onRemoved.addListener((winId) => {
  for (const [tabId, id] of popoutsByTab.entries()) {
    if (id === winId) popoutsByTab.delete(tabId)
  }
})

export async function openViewForTab(tabId: number): Promise<void> {
  const mode = await getDisplayMode()
  if (mode === 'popout') await openPopout(tabId)
  else await openSidePanel(tabId)
}

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
      case 'TOAST_SHOW': {
        await chrome.tabs.sendMessage(req.tabId, { type: 'TOAST_SHOW' })
        return { ok: true, data: null }
      }
      case 'SESSION_START': {
        await openViewForTab(req.tabId)
        await chrome.tabs.sendMessage(req.tabId, { type: 'SESSION_START', url: req.url })
        return { ok: true, data: null }
      }
      case 'OPEN_VIEW': {
        const tabId = req.tabId ?? sender?.tab?.id
        if (tabId === undefined) return { ok: false, error: 'no tabId' }
        await openViewForTab(tabId)
        return { ok: true, data: null }
      }
      case 'CLOSE_VIEW': {
        // Side panel closes itself via window.close(); for popouts, look up by sender window.
        const winId = sender?.tab?.windowId
        if (winId !== undefined) {
          for (const [tabId, id] of popoutsByTab.entries()) {
            if (id === winId) {
              popoutsByTab.delete(tabId)
              try { await chrome.windows.remove(id) } catch { /* ignore */ }
              break
            }
          }
        }
        return { ok: true, data: null }
      }
      case 'SWITCH_MODE': {
        await setDisplayMode(req.mode)
        // Close current view, open new one.
        if (req.mode === 'side-panel') {
          // Switching to side-panel: close popout (if any), open side panel for the original tab.
          await closePopoutForTab(req.tabId)
          await openSidePanel(req.tabId)
        } else {
          // Switching to popout: open popout. Side panel closes itself via window.close() in the caller.
          await openPopout(req.tabId)
        }
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
