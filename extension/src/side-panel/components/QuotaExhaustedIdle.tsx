import type { User, QuotaSnapshot } from '../../shared/types'
import { useT } from '../../shared/i18n'

// Single self-contained card shown when the user is at their monthly
// audio cap AND this URL has no saved notes. Replaces the previous
// "QuotaBanner above + idle text below" stack which read as two
// separate-but-identical messages. Now: ONE bordered card with the
// limit headline, an explanation, the progress bar (so the "you've
// maxed at 100%" visual signal is preserved), and conversion CTAs.
// App.tsx hides the QuotaBanner whenever this card renders to avoid
// the duplication.
//
// CTA branching (free user only — Pro users see info-only):
//   - Never tried the trial → "2시간 무료 받기" prominent (trial offer
//     card with terra accent) + "Pro 가입" small secondary button.
//   - Already tried (declined or expired) → just the regular "Pro 가입"
//     emphasis card (no trial — one-trial-per-account rule).
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
  /** Triggers the 2-hour trial flow (Stripe Checkout in setup mode).
   *  Hidden when user.trial_used is true (one trial per account). */
  onTrialStart?: () => void
  /** Mirrors `upgrading` — true between click and Stripe redirect. */
  trialStarting?: boolean
}

export function QuotaExhaustedIdle({ user, quota, onUpgrade, upgrading, onTrialStart, trialStarting }: Props) {
  const T = useT()
  const isPro = user?.plan === 'pro'
  const limitSecs = quota?.limit_secs ?? (isPro ? 30 * 60 * 60 : 30 * 60)
  const usedDisplay = quota ? Math.min(quota.used_secs, limitSecs) : limitSecs
  // Show the trial offer when: free user, never tried trial, and
  // we have a handler. Pro users skip; users who've already tried
  // skip (one-trial-per-account); if no handler is provided
  // (legacy mount without trial wiring) skip.
  const canOfferTrial = !isPro && user?.trial_used !== true && typeof onTrialStart === 'function'

  return (
    <div className="flex-1 flex items-start justify-center px-4 pt-6">
      <div className="w-full max-w-sm rounded-[14px] border border-paper-edge bg-paper-100 px-5 py-5 shadow-card">
        <p className="text-base font-semibold text-ink-900 mb-2 tracking-headline-tight">
          {isPro ? T.quotaExhausted.pro_title : T.quotaExhausted.free_title}
        </p>
        <p className="text-sm text-ink-700 leading-relaxed whitespace-pre-line mb-4">
          {isPro ? T.quotaExhausted.pro_body : T.quotaExhausted.free_body}
        </p>

        {/* Progress bar — full red since the card only renders at 100%. */}
        <div className="relative h-1.5 w-full rounded-full bg-paper-300 overflow-hidden">
          <div className="absolute inset-y-0 left-0 right-0 bg-warn-red rounded-full" />
        </div>
        <div className="flex items-center justify-between mt-1.5 text-[11px] text-ink-500 font-mono tabular-nums">
          <span>
            {formatMinutes(usedDisplay, T)} / {formatMinutes(limitSecs, T)}
          </span>
          <span className="font-medium text-ink-900">100%</span>
        </div>
        <div className="mt-1 text-[11px] text-ink-300 font-mono">{T.quota.reset_note}</div>

        {/* Trial offer — primary CTA when eligible. Frames the offer
            as "2 free hours" with the safety line directly under the
            button so the trust signal lands at the moment of decision. */}
        {canOfferTrial && (
          <div className="mt-5">
            <div className="rounded-[10px] border border-terra-soft bg-terra-tint px-4 py-3 mb-3">
              <p className="text-sm font-semibold text-terra-700 mb-1 tracking-headline-tight">
                {T.quotaExhausted.trial_offer_title}
              </p>
              <p className="text-xs text-ink-700 leading-relaxed">
                {T.quotaExhausted.trial_offer_body}
              </p>
            </div>
            <button
              type="button"
              onClick={onTrialStart}
              disabled={trialStarting}
              className="w-full rounded-[10px] bg-ink-900 hover:bg-ink-700 disabled:bg-ink-200 disabled:cursor-not-allowed text-paper-100 text-sm font-medium px-4 py-3 transition-colors"
            >
              {trialStarting ? T.quotaExhausted.trial_offer_cta_busy : T.quotaExhausted.trial_offer_cta}
            </button>
            <p className="mt-1.5 text-[10px] text-ink-500 font-mono uppercase tracking-wider text-center">
              {T.quotaExhausted.trial_offer_safety}
            </p>
            {/* Secondary route — for users who'd rather skip trial and
                go straight to a paid subscription. Smaller, less weight. */}
            <button
              type="button"
              onClick={onUpgrade}
              disabled={upgrading}
              className="mt-3 w-full text-xs text-ink-500 hover:text-ink-900 underline-offset-2 hover:underline disabled:opacity-50 disabled:cursor-not-allowed transition-colors py-1"
            >
              {upgrading ? T.quotaExhausted.upgrade_busy : T.quotaExhausted.upgrade_cta}
            </button>
          </div>
        )}

        {/* Standard Pro upsell — shown to free users who already used
            their trial (declined or expired). Pro users see neither. */}
        {!isPro && !canOfferTrial && (
          <>
            <div className="mt-5 rounded-[10px] border border-terra-soft bg-terra-tint px-4 py-3">
              <div className="mb-2">
                <div className="text-lg font-semibold text-terra leading-none tracking-headline-tight font-mono tabular-nums whitespace-nowrap">
                  {T.options.plan_pro_price}
                </div>
                <div className="text-[10px] text-terra-700 opacity-70 mt-1 font-mono uppercase tracking-wider">
                  {T.options.plan_pro_priceNote}
                </div>
              </div>
              <ul className="text-xs text-ink-700 space-y-1">
                <li>{T.options.plan_pro_feature1}</li>
                <li>{T.options.plan_pro_feature2}</li>
              </ul>
            </div>
            <button
              type="button"
              onClick={onUpgrade}
              disabled={upgrading}
              className="mt-3 w-full rounded-[10px] bg-ink-900 hover:bg-ink-700 disabled:bg-ink-200 disabled:cursor-not-allowed text-paper-100 text-sm font-medium px-4 py-3 transition-colors"
            >
              {upgrading ? T.quotaExhausted.upgrade_busy : T.quotaExhausted.upgrade_cta}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
