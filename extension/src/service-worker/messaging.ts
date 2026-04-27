import type { SwRequest, SwResponse } from '../shared/types'
import { loginWithGoogle, logout, authedFetch } from './auth'
import { getUser, setEnabled } from '../shared/storage'
import { updateBadge, broadcastEnabledChange } from './notify'

export async function handle(req: SwRequest, _sender?: chrome.runtime.MessageSender): Promise<SwResponse> {
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
