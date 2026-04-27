import { handle } from './messaging'
import type { SwRequest } from '../shared/types'
import { getEnabled, setEnabled, getUser, hasConsent } from '../shared/storage'

async function updateBadge(enabled: boolean): Promise<void> {
  if (enabled) {
    await chrome.action.setBadgeText({ text: '' })
  } else {
    await chrome.action.setBadgeText({ text: 'OFF' })
    await chrome.action.setBadgeBackgroundColor({ color: '#ef4444' })
  }
}

async function broadcastEnabled(enabled: boolean): Promise<void> {
  // Notify all tabs' content scripts so they can mount/unmount the inline button.
  try {
    const tabs = await chrome.tabs.query({})
    for (const t of tabs) {
      if (t.id === undefined) continue
      try {
        await chrome.tabs.sendMessage(t.id, { type: 'SH_ENABLED_CHANGED', enabled })
      } catch {
        // many tabs won't have content script (chrome:// pages, etc.)
      }
    }
  } catch { /* ignore */ }
}

chrome.runtime.onInstalled.addListener(async () => {
  console.log('[SW] installed')
  const enabled = await getEnabled()
  await updateBadge(enabled)
})

chrome.runtime.onStartup?.addListener(async () => {
  const enabled = await getEnabled()
  await updateBadge(enabled)
})

chrome.action.onClicked.addListener(async (tab) => {
  const user = await getUser()
  const consented = await hasConsent()
  if (!user || !consented) {
    // First-run / not yet authed: open side panel for the auth flow.
    if (tab.windowId !== undefined) {
      try {
        await chrome.sidePanel.setOptions({
          tabId: tab.id,
          path: 'src/side-panel/index.html',
          enabled: true,
        })
      } catch { /* ignore */ }
      await chrome.sidePanel.open({ windowId: tab.windowId })
    }
    return
  }
  // Authed: extension icon click toggles ON/OFF.
  const current = await getEnabled()
  const next = !current
  await setEnabled(next)
  await updateBadge(next)
  await broadcastEnabled(next)
})

chrome.runtime.onMessage.addListener((req: SwRequest, sender, sendResponse) => {
  handle(req, sender)
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: e?.message ?? 'unknown' }))
  return true   // async
})
