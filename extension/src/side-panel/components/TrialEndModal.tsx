import { useState } from 'react'
import { useT } from '../../shared/i18n'
import { reportError } from '../../shared/errors'
import { trialDecline, trialSubscribe } from '../api-client'

// ════════════════════════════════════════════════════════════════════
// Trial-end decision modal
//
// Surfaced when the user has consumed all 2 hours of their one-time
// trial AND has not yet decided what to do next. Two explicit
// outcomes — no implicit auto-charge, no third "later" path that
// would silently keep the saved card on file:
//
//   ┌── "Pro 가입 ¥980/월 (원클릭)" ─→ /v1/billing/subscribe-from-trial
//   │   uses the saved payment method to create the subscription
//   │   server-side. On success the user is now Pro and the parent
//   │   re-renders normal recording UI.
//   │
//   └── "가입 안함" ─→ /v1/trial/decline
//       detaches the saved card on Stripe + marks the grant declined.
//       The user reverts to Free 30-min monthly quota; they cannot
//       start a second trial (one-trial-per-account).
//
// Failure handling:
//   - subscribe failure (card decline, 3DS required, etc.) → toast
//     the localised message + invite user to retry / fall back to
//     the regular Stripe-hosted checkout (parent flow). The modal
//     stays open so the user isn't stranded.
//   - decline failure → log to error toast but optimistically close
//     the modal (the parent will refetch /v1/auth/me and the trial
//     state will reflect reality).
// ════════════════════════════════════════════════════════════════════

interface Props {
  /** Notified once the modal has resolved its action; the parent then
   *  refetches /v1/auth/me and replaces the modal with the regular
   *  Pro / Free idle UI. */
  onResolved: (result: 'subscribed' | 'declined') => void
  /** "Open Stripe checkout" fallback when the one-click subscribe
   *  fails (e.g. card decline). Reuses the existing onUpgrade prop
   *  the parent passes to QuotaExhaustedIdle. */
  onFallbackCheckout: () => void
}

export function TrialEndModal({ onResolved, onFallbackCheckout }: Props) {
  const T = useT()
  const [busy, setBusy] = useState<'subscribe' | 'decline' | null>(null)
  const [subscribeError, setSubscribeError] = useState<string | null>(null)

  const onSubscribe = async () => {
    setBusy('subscribe')
    setSubscribeError(null)
    try {
      await trialSubscribe()
      onResolved('subscribed')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setSubscribeError(msg)
      // Surface to the global toast as well — some failures (network
      // drop, 401) the user wouldn't otherwise notice.
      void reportError(e, { context: 'trial-subscribe', severity: 'error', silent: false })
      setBusy(null)
    }
  }

  const onDecline = async () => {
    setBusy('decline')
    try {
      await trialDecline()
      onResolved('declined')
    } catch (e) {
      // Decline failure is non-fatal — parent refetches and the
      // server is the source of truth either way.
      void reportError(e, { context: 'trial-decline', severity: 'warning', silent: true })
      onResolved('declined')
    }
  }

  return (
    <div className="fixed inset-0 z-[2147483645] bg-ink-900/70 flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-paper-100 rounded-[14px] shadow-card border border-paper-edge p-5">
        <h2 className="text-base font-semibold text-ink-900 tracking-tight mb-2">
          {T.quotaExhausted.trial_end_title}
        </h2>
        <p className="text-sm text-ink-700 leading-relaxed mb-4">
          {T.quotaExhausted.trial_end_body}
        </p>

        {subscribeError && (
          <div className="mb-3 px-3 py-2 rounded-md bg-warn-red/5 border border-warn-red/40 text-warn-red text-xs leading-relaxed">
            {T.quotaExhausted.trial_end_subscribe_failed}
            <button
              type="button"
              onClick={onFallbackCheckout}
              className="block mt-1.5 text-warn-red underline hover:no-underline"
            >
              {T.quotaExhausted.upgrade_cta}
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={onSubscribe}
          disabled={busy !== null}
          className="w-full rounded-[10px] bg-ink-900 hover:bg-ink-700 disabled:bg-ink-200 disabled:cursor-not-allowed text-paper-100 text-sm font-medium px-4 py-3 transition-colors mb-2"
        >
          {busy === 'subscribe' ? T.quotaExhausted.trial_end_subscribe_busy : T.quotaExhausted.trial_end_subscribe}
        </button>
        <button
          type="button"
          onClick={onDecline}
          disabled={busy !== null}
          className="w-full rounded-[10px] border border-paper-edge bg-paper-100 hover:bg-paper-200 disabled:opacity-50 disabled:cursor-not-allowed text-ink-700 text-sm px-4 py-2.5 transition-colors"
        >
          {busy === 'decline' ? T.quotaExhausted.trial_end_decline_busy : T.quotaExhausted.trial_end_decline}
        </button>
      </div>
    </div>
  )
}
