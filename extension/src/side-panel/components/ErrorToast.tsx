import { useEffect, useRef, useState } from 'react'
import { subscribeToErrorToasts } from '../../shared/errors'
import { useT } from '../../shared/i18n'

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
              ? 'bg-amber-50 border border-amber-200 text-amber-900'
              : t.severity === 'fatal'
              ? 'bg-red-50 border border-red-300 text-red-900'
              : 'bg-red-50 border border-red-200 text-red-900'
          }`}
        >
          <span className="text-base leading-none mt-0.5">
            {t.severity === 'warning' ? '⚠️' : '❌'}
          </span>
          <div className="flex-1 leading-relaxed break-words">
            {translate(t.message)}
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

// Translate common backend error strings into user-friendly Japanese.
function translate(msg: string): string {
  if (/HTTP 401|unauthorized|invalid token/i.test(msg)) return '認証が切れました。再度ログインしてください。'
  if (/HTTP 403/.test(msg)) return 'アクセス権限がありません。'
  if (/HTTP 429|rate.?limit/i.test(msg)) return 'リクエストが多すぎます。少し待ってから再試行してください。'
  if (/HTTP 5\d\d/.test(msg)) return 'サーバーエラーが発生しました。しばらくしてから再試行してください。'
  if (/quota|limit reached|exceeded/i.test(msg)) return '利用上限に達しました。Pro プランにアップグレードしてください。'
  if (/no audio (track|track in)|getusermedia|audio.+denied|permission.*audio|microphone/i.test(msg)) {
    return '音声を取得できませんでした。動画に音声があるか、マイク権限を確認してください。'
  }
  if (/permission.*denied|notallowed/i.test(msg)) return '権限が拒否されました。ブラウザの設定を確認してください。'
  if (/network|fetch|failed to fetch|net::err/i.test(msg)) return 'ネットワーク接続を確認してください。'
  if (/sign.?in cancelled|sign.?in failed|oauth.*cancel/i.test(msg)) {
    return 'Google ログインがキャンセルされました。もう一度お試しください。'
  }
  if (/aborted|timeout/i.test(msg)) return 'タイムアウトしました。もう一度お試しください。'
  return msg
}
