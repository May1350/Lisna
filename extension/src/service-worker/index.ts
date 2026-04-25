import { handle } from './messaging'
import type { SwRequest } from '../shared/types'

chrome.runtime.onInstalled.addListener(() => console.log('[SW] installed'))
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.windowId !== undefined) await chrome.sidePanel.open({ windowId: tab.windowId })
})
chrome.runtime.onMessage.addListener((req: SwRequest, _sender, sendResponse) => {
  handle(req).then(sendResponse).catch(e => sendResponse({ ok: false, error: e?.message ?? 'unknown' }))
  return true   // async
})
