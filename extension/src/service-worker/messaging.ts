import type { SwRequest, SwResponse } from '../shared/types'
import { loginWithGoogle, logout, authedFetch } from './auth'
import { getUser } from '../shared/storage'

export async function handle(req: SwRequest): Promise<SwResponse> {
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
        await chrome.sidePanel.open({ tabId: req.tabId })
        await chrome.tabs.sendMessage(req.tabId, { type: 'SESSION_START', url: req.url })
        return { ok: true, data: null }
      }
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' }
  }
  return { ok: false, error: 'unhandled message type' }
}
