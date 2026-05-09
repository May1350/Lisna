import type { User, QuotaSnapshot } from '../../shared/types'
import { useT } from '../../shared/i18n'

// Single self-contained card shown when the user is at their monthly
// audio cap AND this URL has no saved notes. Replaces the previous
// "QuotaBanner above + idle text below" stack which read as two
// separate-but-identical messages. Now: ONE bordered card with the
// limit headline, an explanation, the progress bar (so the "you've
// maxed at 100%" visual signal is preserved), and a single
// upgrade CTA. App.tsx hides the QuotaBanner whenever this card
// renders to avoid the duplication.
//
// For URLs that DO have saved notes, the card is NOT used — the
// regular modal renders so the user can still read / regenerate
// existing content, and the capture-disabled signal lives inline in
// SessionControls (gray inactive button).

function formatMinutes(secs: number, T: ReturnType<typeof useT>): string {
  const mins = Math.floor(secs / 60)
  const rem = secs % 60
  if (mins === 0) return `${rem}${T.common.seconds}`
  if (rem === 0) return `${mins}${T.common.minutes}`
  return `${mins}${T.common.minutes}${rem}${T.common.seconds}`
}

interface Props {
  user: User | null
  /** Live quota snapshot for the in-card progress bar. Optional so
   *  the card still renders correctly during the brief gap before
   *  /v1/auth/me lands; the bar just stays at the value implied by
   *  the user's plan when missing (clamped to 100% since this card
   *  only appears when exhausted anyway). */
  quota?: QuotaSnapshot | null
  /** Triggers the same Stripe Checkout flow as the Options page Plan
   *  section. Passed in so this component stays presentational. */
  onUpgrade: () => void
  /** Mirrors PlanSection's busy state — the upgrade click triggers a
   *  network round trip + redirect, surfacing it disables the button
   *  during the few hundred ms before the navigation lands. */
  upgrading: boolean
}

export function QuotaExhaustedIdle({ user, quota, onUpgrade, upgrading }: Props) {
  const T = useT()
  const isPro = user?.plan === 'pro'
  const limitSecs = quota?.limit_secs ?? (isPro ? 30 * 60 * 60 : 30 * 60)
  const usedDisplay = quota ? Math.min(quota.used_secs, limitSecs) : limitSecs

  return (
    <div className="flex-1 flex items-start justify-center px-4 pt-6">
      <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-white px-5 py-5 shadow-sm">
        {/* Headline — single short phrase, no emoji. Plan-aware so
            Pro users at the 30 h ceiling don't see free-tier copy. */}
        <p className="text-base font-semibold text-gray-900 mb-2">
          {isPro ? T.quotaExhausted.pro_title : T.quotaExhausted.free_title}
        </p>
        {/* Body — what the user CAN still do. Critical for trust
            (the regular modal red-banner used to imply the whole
            feature broke). */}
        <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-line mb-4">
          {isPro ? T.quotaExhausted.pro_body : T.quotaExhausted.free_body}
        </p>

        {/* Progress bar — same visual language as QuotaBanner's compact
            variant so users have a single mental model for "where am I
            on the meter". Always full red when this card renders. */}
        <div className="relative h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
          <div className="absolute inset-y-0 left-0 right-0 bg-red-500 rounded-full" />
        </div>
        <div className="flex items-center justify-between mt-1.5 text-[11px] text-gray-500 tabular-nums">
          <span>
            {formatMinutes(usedDisplay, T)} / {formatMinutes(limitSecs, T)}
          </span>
          <span className="font-medium">100%</span>
        </div>
        <div className="mt-1 text-[11px] text-gray-400">{T.quota.reset_note}</div>

        {/* Pro upgrade chunk — adds the price + 2 key features
            inline so the user doesn't have to leave the modal to
            check what they're paying for. Visual brand chunk
            (indigo bordered box) mirrors PlanSection's upgrade
            card semiotic so the two surfaces feel consistent
            without duplicating the full bullets list. We pick
            features 1+2 (the 60× scale and long-lecture
            confidence) — feature 3 (cooldown) is less load-
            bearing in the crisis context and would push the card
            taller without adding decision value. Strings reuse
            T.options.plan_pro_* so the price / copy stay in one
            place across both surfaces. */}
        {!isPro && (
          <>
            <div className="mt-5 rounded-lg border border-indigo-200 bg-indigo-50/40 px-4 py-3">
              <div className="flex items-baseline justify-between gap-2 mb-1.5">
                <span className="text-lg font-semibold text-indigo-900 leading-none tracking-tight">
                  {T.options.plan_pro_price}
                </span>
                <span className="text-[11px] text-indigo-700/70 shrink-0">
                  {T.options.plan_pro_priceNote}
                </span>
              </div>
              <ul className="text-xs text-gray-700 space-y-1">
                <li>{T.options.plan_pro_feature1}</li>
                <li>{T.options.plan_pro_feature2}</li>
              </ul>
            </div>
            <button
              type="button"
              onClick={onUpgrade}
              disabled={upgrading}
              className="mt-3 w-full rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-3 transition"
            >
              {upgrading ? T.quotaExhausted.upgrade_busy : T.quotaExhausted.upgrade_cta}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
