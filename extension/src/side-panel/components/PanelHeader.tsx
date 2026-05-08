import type { User } from '../../shared/types'
import { SpeedSelector } from './SpeedSelector'
import { useT, interpolate } from '../../shared/i18n'

// Modern minimalist gear icon for opening the Options page. Uses
// chrome.runtime.openOptionsPage() — the canonical way to open the
// extension's manifest-declared options_page in a new tab. Visible
// in BOTH the side-panel (account view) and the in-page modal so
// users always have one click away from the settings, regardless of
// which surface they're in.
function SettingsButton() {
  const T = useT()
  const open = () => {
    try { chrome.runtime.openOptionsPage() }
    catch { /* not available in all contexts; ignore */ }
  }
  return (
    <button
      type="button"
      onClick={open}
      title={T.panelHeader.settingsTitle}
      aria-label={T.panelHeader.settingsAria}
      className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition"
    >
      <GearIcon />
    </button>
  )
}

// Modern minimal gear: thin stroke, 8 teeth, no fill. Inspired by
// Heroicons' Cog 6-Tooth but tightened for a 16px button context.
function GearIcon() {
  return (
    <svg
      width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

interface Props {
  user: User | null
  /** True when this app is rendering inside the in-page iframe modal. */
  isEmbed: boolean
  /** Only used in side-panel (account) view. */
  enabled?: boolean
  /** Only used in side-panel (account) view. */
  onToggleEnabled?: (next: boolean) => void
  /** Only used in embed (modal) view. */
  playbackSpeed?: number
  /** Only used in embed (modal) view. */
  onSpeedChange?: (n: number) => void
  /** Free-plan users see a real-time tick-down of their monthly
   *  remaining quota in MM:SS format below their plan badge. Only
   *  meaningful in embed (modal) view AND for the free plan. */
  liveRemainingSecs?: number | null
  onClose: () => void
  onLogout: () => void
}

function formatMmSs(secs: number): string {
  const safe = Math.max(0, Math.floor(secs))
  const m = Math.floor(safe / 60)
  const s = safe % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function PanelHeader({
  user,
  isEmbed,
  enabled,
  onToggleEnabled,
  playbackSpeed,
  onSpeedChange,
  liveRemainingSecs,
  onClose,
  onLogout,
}: Props) {
  const T = useT()
  // Free users get a live MM:SS counter; pro users don't (their
  // 30 h/月 quota is generous enough that real-time tracking would
  // be visual noise). Show only when we have a live value AND the
  // user is on free.
  const showLiveRemaining = isEmbed && user?.plan === 'free' && typeof liveRemainingSecs === 'number'
  // Colour ramp matches QuotaBanner stages so the pill and the
  // banner agree visually as the user gets closer to the wall.
  const remainingClass = (() => {
    if (!showLiveRemaining || liveRemainingSecs == null) return ''
    if (liveRemainingSecs <= 60) return 'bg-red-100 text-red-800'      // <1 min
    if (liveRemainingSecs <= 300) return 'bg-amber-100 text-amber-800' // <5 min
    return 'bg-gray-100 text-gray-700'
  })()
  const isAccountView = !isEmbed
  const showToggle =
    isAccountView && typeof enabled === 'boolean' && typeof onToggleEnabled === 'function'

  return (
    <header className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-200 bg-white">
      <div className="flex flex-col min-w-0">
        {user ? (
          isEmbed ? (
            // Embed mode: minimal — email + plan badge only. Account toggles
            // (ON/OFF, logout) live in the Chrome native side panel.
            <>
              <span className="text-xs font-semibold text-gray-900 truncate" title={user.email}>
                👤 {user.email}
              </span>
              <span className="text-[11px] text-gray-500 flex items-center gap-1.5">
                <span>{user.plan === 'pro' ? T.quota.plan_pro : T.quota.plan_free}</span>
                {showLiveRemaining && (
                  <span
                    className={`px-1.5 py-[1px] rounded font-mono tabular-nums text-[10px] font-medium ${remainingClass}`}
                    title={T.quota.remainingTooltip}
                  >
                    {T.panelHeader.remainingPrefix} {formatMmSs(liveRemainingSecs!)}
                  </span>
                )}
              </span>
            </>
          ) : (
            <>
              <span className="text-xs font-semibold text-gray-900 truncate" title={user.email}>
                👤 {user.email}
              </span>
              <button
                type="button"
                onClick={onLogout}
                className="text-[11px] text-gray-500 hover:text-gray-700 text-left"
                title={T.panelHeader.logoutTooltip}
              >
                {interpolate(T.panelHeader.planLogoutCombo, {
                  plan: user.plan === 'pro' ? T.quota.plan_pro : T.quota.plan_free,
                })}
              </button>
            </>
          )
        ) : (
          <span className="text-xs text-gray-500">{T.panelHeader.notLoggedIn}</span>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {isEmbed && typeof playbackSpeed === 'number' && typeof onSpeedChange === 'function' && (
          <SpeedSelector current={playbackSpeed} onChange={onSpeedChange} />
        )}
        <SettingsButton />
        {showToggle && (
          <label
            className="flex items-center gap-1.5 text-[11px] text-gray-700 cursor-pointer select-none"
            title={enabled ? T.panelHeader.toggleOnTitle : T.panelHeader.toggleOffTitle}
          >
            <span className="font-medium">{enabled ? T.panelHeader.on : T.panelHeader.off}</span>
            <input
              type="checkbox"
              role="switch"
              aria-label={T.panelHeader.toggleAria}
              checked={enabled}
              onChange={(e) => onToggleEnabled?.(e.target.checked)}
              className="sr-only peer"
            />
            <span
              aria-hidden="true"
              className={`relative inline-block w-8 h-[18px] rounded-full transition-colors ${
                enabled ? 'bg-emerald-500' : 'bg-gray-300'
              }`}
            >
              <span
                className={`absolute top-[2px] left-[2px] w-[14px] h-[14px] bg-white rounded-full shadow transition-transform ${
                  enabled ? 'translate-x-[14px]' : 'translate-x-0'
                }`}
              />
            </span>
          </label>
        )}
        <button
          type="button"
          onClick={onClose}
          title={T.panelHeader.closeTitle}
          aria-label={T.panelHeader.closeAria}
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 text-gray-600"
        >
          ✕
        </button>
      </div>
    </header>
  )
}
