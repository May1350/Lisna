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

        {/* Pro upgrade chunk — emphasis card variant per DESIGN.md §3.2.
            terra-tint surface + terra-soft border + terra price text,
            then ink-900 solid CTA below. */}
        {!isPro && (
          <>
            <div className="mt-5 rounded-[10px] border border-terra-soft bg-terra-tint px-4 py-3">
              {/* Price + note stacked, not side-by-side. The previous
                  flex-justify-between layout cramped the price into a
                  shrinking column whenever the note string was long
                  ("Billed monthly · Cancel anytime") and the price's
                  whitespace ("¥980 / month") would wrap onto three
                  lines. Stacking guarantees both fit at any locale
                  width; whitespace-nowrap on the price is belt-and-
                  suspenders against future card-width shrinks. */}
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
