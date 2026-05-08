import type { User, QuotaSnapshot } from '../../shared/types'
import { useT, interpolate } from '../../shared/i18n'

// Quota banner with the user-driven thresholds:
//
//   < 90%        : nothing rendered (no banner, no plan label)
//   90% – 99%    : amber warning + Pro CTA shown ONCE per session
//   100% / blocked : red blocking banner (capture has been stopped)
//
// We deliberately do NOT show a "X% 사용 중" string at low usage anymore —
// the user found the constant counter distracting. The banner reappears
// only when there's something they need to act on. Pro users still cross
// 90% on long sessions (30 h/月), so we render the warning for them too,
// just without the upgrade button.

import { useEffect, useRef } from 'react'

function formatMinutes(secs: number, T: ReturnType<typeof useT>): string {
  const mins = Math.floor(secs / 60)
  const rem = secs % 60
  if (mins === 0) return `${rem}${T.common.seconds}`
  if (rem === 0) return `${mins}${T.common.minutes}`
  return `${mins}${T.common.minutes}${rem}${T.common.seconds}`
}

interface Props {
  user: User | null
  quota?: QuotaSnapshot | null
  onUpgrade: () => void
  /** True when the most recent /v1/stream/audio returned 402. Forces the
   *  blocking banner regardless of the snapshot's percent_used. */
  blocked?: boolean
}

export function QuotaBanner({ user, quota, onUpgrade, blocked }: Props) {
  const T = useT()
  // Suppress duplicate 90% warnings within a single mounted lifetime —
  // the banner toggles back-on once after first crossing into the warning
  // band, so the user gets the nudge but doesn't see it flash on every
  // chunk update from then on. Reset when usage drops back below 90%.
  const warnedRef = useRef(false)

  const pct = quota ? (blocked ? 100 : quota.percent_used) : 0

  useEffect(() => {
    if (pct < 90) warnedRef.current = false
    else if (pct < 100) warnedRef.current = true
  }, [pct])

  if (!user) return null
  if (!quota) return null
  if (pct < 90) return null

  // 100% — blocking
  if (pct >= 100) {
    return (
      <div className="bg-red-50 border border-red-300 text-sm text-red-900 px-3 py-2 rounded m-2">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium">{T.quota.blocked_label}</span>
          {user.plan === 'free' && (
            <button onClick={onUpgrade} className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium px-2 py-1 rounded">
              {T.quota.upgradeButton}
            </button>
          )}
        </div>
        <div className="text-xs mt-1 opacity-80">
          {interpolate(T.quota.blocked_meta, {
            used: formatMinutes(quota.used_secs, T),
            limit: formatMinutes(quota.limit_secs, T),
          })}
        </div>
      </div>
    )
  }

  // 90–99% — single amber warning
  return (
    <div className="bg-amber-50 border border-amber-300 text-sm text-amber-900 px-3 py-2 rounded m-2">
      <div className="flex items-center justify-between gap-2">
        <span>{interpolate(T.quota.warn_label, {
          remaining: formatMinutes(Math.max(0, quota.remaining_secs), T),
          pct,
        })}</span>
        {user.plan === 'free' && (
          <button onClick={onUpgrade} className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium px-2 py-1 rounded">
            {T.quota.upgradeButton}
          </button>
        )}
      </div>
    </div>
  )
}
