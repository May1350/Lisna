import type { SwRequest, SwResponse } from '../shared/types'
import { loginWithGoogle, logout, authedFetch } from './auth'
import { getUser, setEnabled } from '../shared/storage'
import { updateBadge, broadcastEnabledChange } from './notify'
import { API_BASE_URL } from '../shared/config'

export async function handle(req: SwRequest, _sender?: chrome.runtime.MessageSender): Promise<SwResponse> {
  try {
    switch (req.type) {
      case 'AUTH_LOGIN': {
        const r = await loginWithGoogle(req.currentUrl)
        return { ok: true, data: r }
      }
      case 'AUTH_LOGOUT': {
        await logout()
        return { ok: true, data: null }
      }
      case 'AUTH_GET_USER': {
        const u = await getUser()
        return { ok: true, data: u }
      }
      case 'WARMUP': {
        // Fire-and-forget pings to the cold-start-sensitive endpoints in the
        // login + first-chunk path. Each request triggers Node init + VPC ENI
        // attach, and the resulting warm container survives ~5-15 min — long
        // enough to cover the user's real click that follows. We don't await
        // the responses (the user doesn't see this work) and we tolerate any
        // failure silently because warmup is best-effort by definition.
        const targets = ['/v1/auth/google', '/v1/session', '/v1/stream/audio']
        for (const path of targets) {
          // Use POST so /v1/stream/audio (POST-only route) accepts the ping
          // — the Body is ignored because isWarmup short-circuits before the
          // Zod validator runs.
          void fetch(`${API_BASE_URL}${path}?warmup=1`, {
            method: 'POST',
            headers: { 'x-sh-warmup': '1' },
          }).catch(() => { /* ignore */ })
        }
        return { ok: true, data: null }
      }
      case 'API_FETCH': {
        const r = await authedFetch(
          req.path,
          {
            method: req.method,
            body: req.body ? JSON.stringify(req.body) : undefined,
          },
          req.absoluteUrl,
        )
        const text = await r.text()
        let parsed: unknown
        try { parsed = JSON.parse(text) } catch { parsed = text }
        if (!r.ok) {
          // Pass the parsed body + status back even on failure. Some routes
          // (notably /v1/stream/audio on quota_exceeded) embed structured
          // payloads — e.g. { error: 'quota_exceeded', quota: {...} } — that
          // the content script must surface to the modal as a banner. If we
          // collapsed everything to a string here those fields would be
          // unrecoverable without re-parsing.
          return {
            ok: false,
            error: `HTTP ${r.status}: ${text}`,
            status: r.status,
            data: parsed,
          }
        }
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
      case 'JUMP_TO_REQUEST': {
        // Side-panel users don't have a parent window to postMessage to.
        // Forward to whichever tab is active so its top-frame content
        // script can route to the frame holding the <video>.
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        if (tab?.id !== undefined) {
          try {
            await chrome.tabs.sendMessage(tab.id, { type: 'JUMP_TO', ts: req.ts })
          } catch {
            // Tab might not have our content script (e.g. chrome:// pages).
          }
        }
        return { ok: true, data: null }
      }
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' }
  }
  return { ok: false, error: 'unhandled message type' }
}
