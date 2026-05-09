import type { User, QuotaSnapshot } from '../../shared/types'
import { useT } from '../../shared/i18n'

// Quota banner with the user-driven thresholds:
//
//   < 90%        : nothing rendered (no banner, no plan label)
//   90% – 99%    : warning state — amber progress fill, upgrade CTA
//   100% / blocked : limit-reached state — red progress fill, upgrade CTA
//
// Visual is a calm card (white surface, light border) plus a thin
// progress bar that carries the usage number visually so the headline
// can be a single short phrase. Replaces the previous emoji-prefixed
// "⛔ 월간 사용량을 모두 소진했어요 / 사용 X / Y" stack which read
// as alert-y / AI-generated.

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

  const pct = quota ? (blocked ? 100 : quota.percent_used) : 0

  if (!user) return null
  if (!quota) return null
  if (pct < 90) return null

  const isBlocked = pct >= 100
  const headline = isBlocked ? T.quota.blocked_label : T.quota.warn_label
  // Progress bar fill colour swaps red/amber to mirror the headline
  // intent. Kept on a neutral gray track so it reads as a calm meter
  // rather than the previous full-bleed coloured background.
  const fillClass = isBlocked ? 'bg-red-500' : 'bg-amber-500'

  return (
    <div className="mx-3 mb-1 rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="text-sm font-semibold text-gray-900">{headline}</div>
        {user.plan === 'free' && (
          <button
            type="button"
            onClick={onUpgrade}
            className="shrink-0 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium px-3 py-1.5 transition"
          >
            {T.quota.upgradeButton}
          </button>
        )}
      </div>
      {/* Progress bar — track + filled width clamped to 100. The
          width is set inline (Tailwind can't generate arbitrary
          dynamic percentages from a runtime number). */}
      <div className="relative h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
        <div
          className={`absolute inset-y-0 left-0 rounded-full ${fillClass}`}
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
      <div className="flex items-center justify-between mt-1.5 text-[11px] text-gray-500 tabular-nums">
        <span>
          {formatMinutes(quota.used_secs, T)} / {formatMinutes(quota.limit_secs, T)}
        </span>
        <span className="font-medium">{Math.min(100, pct)}%</span>
      </div>
      <div className="mt-1 text-[11px] text-gray-400">{T.quota.reset_note}</div>
    </div>
  )
}
