import { useState } from 'react'
import type { QuotaSnapshot } from '../../shared/types'
import { useT } from '../../shared/i18n'
import { reportError } from '../../shared/errors'
import { trialSubscribe } from '../api-client'

// ════════════════════════════════════════════════════════════════════
// Trial 90-99 % nudge banner
//
// Active-trial counterpart of QuotaBanner. Surfaces between 90 % and
// 99 % of the 2 h trial budget (at 100 % the TrialEndModal takes over).
// CTA differs from QuotaBanner: trial users already have a card on
// file, so "Pro 가입" goes through the one-click /v1/billing/subscribe-
// from-trial path instead of opening Stripe Checkout.
// ════════════════════════════════════════════════════════════════════

function formatRemaining(secs: number, T: ReturnType<typeof useT>): string {
  const safe = Math.max(0, secs)
  const mins = Math.floor(safe / 60)
  const rem = safe % 60
  if (mins === 0) return `${rem}${T.common.seconds}`
  if (rem === 0) return `${mins}${T.common.minutes}`
  return `${mins}${T.common.minutes}${rem}${T.common.seconds}`
}

interface Props {
  quota: QuotaSnapshot
  /** Called after successful one-click subscribe so the parent can
   *  refetch /v1/auth/me + swap the UI to the Pro recording surface. */
  onResolved: (result: 'subscribed') => void
  /** Stripe Checkout fallback if the saved PM is declined / 3DS / gone. */
  onFallbackCheckout: () => void
}

export function TrialNudgeBanner({ quota, onResolved, onFallbackCheckout }: Props) {
  const T = useT()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const onSubscribe = async () => {
    if (busy) return
    setBusy(true)
    setFailed(false)
    try {
      await trialSubscribe()
      onResolved('subscribed')
    } catch (e) {
      setFailed(true)
      void reportError(e, { context: 'trial-nudge-subscribe', severity: 'error', silent: false })
      setBusy(false)
    }
  }

  const remaining = formatRemaining(quota.remaining_secs, T)
  const title = T.quotaExhausted.trial_nudge_title.replace('{remaining}', remaining)
  const pct = Math.min(100, quota.percent_used)

  return (
    <div className="mx-3 mb-1 rounded-[10px] border border-paper-edge bg-paper-100 px-4 py-3 shadow-card">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-ink-900 truncate">{title}</div>
          <div className="text-[11px] text-ink-500 mt-0.5">
            {T.quotaExhausted.trial_nudge_body}
          </div>
        </div>
        <button
          type="button"
          onClick={onSubscribe}
          disabled={busy}
          className="shrink-0 rounded-md bg-ink-900 hover:bg-ink-700 disabled:bg-ink-200 disabled:cursor-not-allowed text-paper-100 text-xs font-medium px-3 py-1.5 transition-colors"
        >
          {T.quotaExhausted.trial_nudge_cta}
        </button>
      </div>
      <div className="relative h-1.5 w-full rounded-full bg-paper-300 overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-warn-amber"
          style={{ width: `${pct}%` }}
        />
      </div>
      {failed && (
        <button
          type="button"
          onClick={onFallbackCheckout}
          className="mt-2 text-[11px] text-warn-red underline hover:no-underline"
        >
          {T.quotaExhausted.trial_end_subscribe_failed}
        </button>
      )}
    </div>
  )
}
