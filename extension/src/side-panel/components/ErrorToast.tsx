import { useEffect, useRef, useState } from 'react'
import { subscribeToErrorToasts } from '../../shared/errors'
import { useT } from '../../shared/i18n'
import type { Translations } from '../../shared/i18n'

interface Toast {
  id: number
  message: string
  severity: 'fatal' | 'error' | 'warning'
}

let nextId = 1

/**
 * Subscribes to reportError calls and renders a stack of dismissable toasts.
 * Auto-dismiss: warnings 4 s, errors 8 s, fatals never (user dismisses).
 */
export function ErrorToast() {
  const T = useT()
  const [toasts, setToasts] = useState<Toast[]>([])
  // Track each toast's auto-dismiss timer so we can:
  //   1. clearTimeout all pending timers on unmount (no late
  //      `setToasts` calls after the component is gone), and
  //   2. clearTimeout the specific timer when the user manually
  //      dismisses a toast (otherwise the now-redundant timer would
  //      still fire and call setToasts post-removal).
  const timersRef = useRef<Map<number, number>>(new Map())

  // Helper: dismiss a toast by id, clearing its pending timer.
  const dismissToast = (id: number) => {
    const t = timersRef.current.get(id)
    if (t !== undefined) {
      window.clearTimeout(t)
      timersRef.current.delete(id)
    }
    setToasts(prev => prev.filter(x => x.id !== id))
  }

  useEffect(() => {
    const unsubscribe = subscribeToErrorToasts(({ message, severity }) => {
      const id = nextId++
      setToasts(prev => [...prev, { id, message, severity }])
      const ttl = severity === 'fatal' ? 0 : severity === 'warning' ? 4000 : 8000
      if (ttl > 0) {
        const handle = window.setTimeout(() => {
          timersRef.current.delete(id)
          setToasts(prev => prev.filter(t => t.id !== id))
        }, ttl)
        timersRef.current.set(id, handle)
      }
    })
    return () => {
      unsubscribe()
      // Clear every still-pending timer so unmount can't trigger a
      // setToasts on an unmounted component.
      const timers = timersRef.current
      for (const handle of timers.values()) window.clearTimeout(handle)
      timers.clear()
    }
  }, [])

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-3 left-3 right-3 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`pointer-events-auto rounded-lg shadow-lg px-3 py-2.5 text-xs flex items-start gap-2 ${
            t.severity === 'warning'
              ? 'bg-warn-amber/10 border border-warn-amber/40 text-ink-900'
              : t.severity === 'fatal'
              ? 'bg-warn-red/5 border border-warn-red/40 text-warn-red'
              : 'bg-warn-red/5 border border-warn-red/30 text-warn-red'
          }`}
        >
          <span
            className={`inline-block w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${
              t.severity === 'warning' ? 'bg-warn-amber' : 'bg-warn-red'
            }`}
            aria-hidden
          />
          <div className="flex-1 leading-relaxed break-words">
            {translate(t.message, T)}
          </div>
          <button
            onClick={() => dismissToast(t.id)}
            className="opacity-60 hover:opacity-100 transition text-base leading-none px-1"
            aria-label={T.common.close}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}

// Translate common backend error strings into user-friendly localised
// copy. Pattern table is locale-agnostic — message strings (HTTP/text
// fragments) come from the backend or browser APIs and don't depend on
// the user's UI language. Result strings come from the active locale.
// Unmatched messages fall through to the original (visible to user is
// preferable to silent dropping when something unexpected breaks).
function translate(msg: string, T: Translations): string {
  const E = T.errorToast
  if (/HTTP 401|unauthorized|invalid token/i.test(msg)) return E.unauthorized
  if (/HTTP 403/.test(msg)) return E.forbidden
  if (/HTTP 429|rate.?limit/i.test(msg)) return E.rateLimit
  if (/HTTP 5\d\d/.test(msg)) return E.server
  if (/quota|limit reached|exceeded/i.test(msg)) return E.quotaExceeded
  if (/no audio (track|track in)|getusermedia|audio.+denied|permission.*audio|microphone/i.test(msg)) {
    return E.audioCapture
  }
  if (/permission.*denied|notallowed/i.test(msg)) return E.permission
  if (/network|fetch|failed to fetch|net::err/i.test(msg)) return E.network
  if (/sign.?in cancelled|sign.?in failed|oauth.*cancel/i.test(msg)) {
    return E.oauthCancelled
  }
  if (/aborted|timeout/i.test(msg)) return E.timeout
  return msg
}
