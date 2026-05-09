import type { User } from '../../shared/types'
import { useT } from '../../shared/i18n'

// Replaces IdleSessionState when the user is at their monthly audio
// quota AND this URL has no saved notes / transcripts. The default
// idle copy ("press play and we'll curate") is misleading here —
// pressing play would just produce zero captions because every chunk
// 402's. Show a clear "limit reached, here's the upgrade path"
// surface instead.
//
// For URLs that DO have saved notes, this component is NOT used —
// the regular modal renders so the user can still read / regenerate
// existing content. The capture-disabled signal lives inline in
// SessionControls (gray inactive button) for that case.

interface Props {
  user: User | null
  /** Triggers the same Stripe Checkout flow as the Options page Plan
   *  section. Passed in so this component stays presentational. */
  onUpgrade: () => void
  /** Mirrors PlanSection's busy state — the upgrade click triggers a
   *  network round trip + redirect, surfacing it disables the button
   *  during the few hundred ms before the navigation lands. */
  upgrading: boolean
}

export function QuotaExhaustedIdle({ user, onUpgrade, upgrading }: Props) {
  const T = useT()
  const isPro = user?.plan === 'pro'

  // Pro users theoretically can hit the 30 h/month ceiling. No
  // upgrade path exists for them — we just explain the reset and
  // hide the button rather than showing a dead "upgrade" CTA.
  if (isPro) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-10 text-center text-gray-700">
        <div className="max-w-sm">
          <p className="text-base font-semibold text-gray-900 mb-3">
            {T.quotaExhausted.pro_title}
          </p>
          <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-line">
            {T.quotaExhausted.pro_body}
          </p>
        </div>
      </div>
    )
  }

  // Free user — show the upgrade card.
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-10 text-gray-700">
      <div className="max-w-sm w-full">
        <p className="text-base font-semibold text-gray-900 mb-2">
          {T.quotaExhausted.free_title}
        </p>
        <p className="text-sm text-gray-600 leading-relaxed mb-5 whitespace-pre-line">
          {T.quotaExhausted.free_body}
        </p>
        <button
          type="button"
          onClick={onUpgrade}
          disabled={upgrading}
          className="w-full rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-3 transition"
        >
          {upgrading ? T.quotaExhausted.upgrade_busy : T.quotaExhausted.upgrade_cta}
        </button>
      </div>
    </div>
  )
}
