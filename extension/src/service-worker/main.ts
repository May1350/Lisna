import { handle, REENABLE_ALARM } from './messaging'
import { updateBadge, broadcastEnabledChange } from './notify'
import type { SwRequest } from '../shared/types'
import { getEnabled, getDisabledUntil, setEnabled, setDisabledUntil } from '../shared/storage'

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
  warmupBackend('install')
})

chrome.runtime.onStartup?.addListener(async () => {
  // Catch-up: if the user opened Chrome after the disable window
  // already passed (e.g. they closed Chrome at hour 0 and reopened at
  // hour 25), the chrome.alarm may not have fired. Re-enable here so
  // they don't see a stale OFF state.
  await maybeAutoReenable()
  const enabled = await getEnabled()
  await updateBadge(enabled)
  warmupBackend('startup')
})

// chrome.alarms.onAlarm fires the moment our scheduled `when` is reached
// even if the SW is asleep — Chrome wakes the SW for the listener call.
chrome.alarms?.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== REENABLE_ALARM) return
  await reenable('alarm')
})

async function maybeAutoReenable(): Promise<void> {
  const until = await getDisabledUntil()
  if (until == null) return
  if (Date.now() < until) return    // still in the disable window
  await reenable('catchup')
}

async function reenable(reason: 'alarm' | 'catchup'): Promise<void> {
  console.log('[SW] auto re-enable', reason)
  await setEnabled(true)
  await setDisabledUntil(null)
  try { await chrome.alarms.clear(REENABLE_ALARM) } catch { /* may already be cleared */ }
  await updateBadge(true)
  await broadcastEnabledChange(true)
}

// Best-effort Lambda pre-warm. Triggers on extension install / browser
// startup and again on demand from content scripts that detect a video.
// Cold start on the auth + stream paths is 1-3 s on the VPC Lambdas; firing
// these a moment before the user clicks the inline button typically lands
// the warm container in time for the real call.
function warmupBackend(reason: string): void {
  console.log('[SW] warmup', reason)
  // Self-handle to keep this function side-effecty without touching the
  // public message handler types — call our own handle() via dispatch.
  void handle({ type: 'WARMUP' } as never)
    .catch(e => console.warn('[SW] warmup failed', e))
}

// NOTE: chrome.action.onClicked is intentionally NOT registered. With
// setPanelBehavior({ openPanelOnActionClick: true }) above, Chrome consumes
// the icon click to open the side panel and does not fire onClicked.

chrome.runtime.onMessage.addListener((req: SwRequest, sender, sendResponse) => {
  handle(req, sender)
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: e?.message ?? 'unknown' }))
  return true   // async
})
