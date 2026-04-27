import { handle } from './messaging'
import { updateBadge } from './notify'
import type { SwRequest } from '../shared/types'
import { getEnabled } from '../shared/storage'

chrome.runtime.onInstalled.addListener(async () => {
  console.log('[SW] installed')
  // Auto-open the side panel when the user clicks the toolbar icon. This is
  // the only Chrome-supported way to open the side panel without consuming a
  // user gesture inside a runtime.onMessage handler (Chrome 116+ enforces it).
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  } catch (e) {
    console.warn('[SW] setPanelBehavior failed', e)
  }
  const enabled = await getEnabled()
  await updateBadge(enabled)
})

chrome.runtime.onStartup?.addListener(async () => {
  const enabled = await getEnabled()
  await updateBadge(enabled)
})

// NOTE: chrome.action.onClicked is intentionally NOT registered. With
// setPanelBehavior({ openPanelOnActionClick: true }) above, Chrome consumes
// the icon click to open the side panel and does not fire onClicked.

chrome.runtime.onMessage.addListener((req: SwRequest, sender, sendResponse) => {
  handle(req, sender)
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: e?.message ?? 'unknown' }))
  return true   // async
})
