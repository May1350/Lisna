import type { User } from '../../shared/types'
import { SpeedSelector } from './SpeedSelector'
import { useT, interpolate } from '../../shared/i18n'

// ── Avatar helpers ────────────────────────────────────────────────────
//
// 6-step palette in the cool/violet family. All gradients are within the
// Lisna brand vicinity so the surface stays cohesive, but distinct
// enough that a user juggling two Google accounts can tell at a glance
// which one is currently signed in (directly addresses the "wrong
// account → wrong plan" trap that drove the recent account-switch UX).
//
// Pro plan ALWAYS uses palette[0] (indigo) so the paid tier reads as a
// consistent visual identity regardless of the user's email hash.
const AVATAR_PALETTE: ReadonlyArray<readonly [string, string]> = [
  ['#6366f1', '#8b5cf6'],  // indigo → violet (Pro default)
  ['#3b82f6', '#6366f1'],  // blue → indigo
  ['#8b5cf6', '#a855f7'],  // violet → purple
  ['#06b6d4', '#3b82f6'],  // cyan → blue
  ['#a855f7', '#ec4899'],  // purple → pink
  ['#0ea5e9', '#8b5cf6'],  // sky → violet
]

// djb2-style string hash. We don't need cryptographic strength — only
// "same input → same palette index" so the avatar colour is stable for a
// given account across sessions.
function hashSeed(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0
  return h
}

function avatarPalette(user: User): readonly [string, string] {
  if (user.plan === 'pro') return AVATAR_PALETTE[0]
  return AVATAR_PALETTE[hashSeed(user.email) % AVATAR_PALETTE.length]
}

// First displayable character of name (preferred) or email. Uses
// Array.from to be Unicode-safe — `'🌟abc'[0]` returns a broken
// surrogate half, but `[...'🌟abc'][0]` returns the full grapheme. CJK
// (Korean, Japanese, Chinese) characters render at the same size and
// don't case-fold so toLocaleUpperCase is a no-op for them.
function avatarInitial(user: User): string {
  const src = (user.name?.trim() || user.email).trim()
  const ch = Array.from(src)[0] ?? '?'
  return ch.toLocaleUpperCase()
}

function Avatar({ user }: { user: User }) {
  const [from, to] = avatarPalette(user)
  const initial = avatarInitial(user)
  const isPro = user.plan === 'pro'
  return (
    <div
      className="w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-white text-[12.5px] font-semibold select-none leading-none"
      style={{
        background: `linear-gradient(135deg, ${from}, ${to})`,
        // Pro: a soft indigo ring sits 1.5 px outside the avatar so the
        // paid tier reads as elevated without changing layout. Free:
        // just a subtle drop shadow for definition against white.
        boxShadow: isPro
          ? '0 0 0 1.5px #ffffff, 0 0 0 3px rgba(165,180,252,0.7), 0 1px 4px rgba(99,102,241,0.4)'
          : '0 1px 2px rgba(15,23,42,0.15)',
      }}
      aria-hidden="true"
      title={user.email}
    >
      {initial}
    </div>
  )
}

// Modern minimalist gear icon for opening the Options page. Uses
// chrome.runtime.openOptionsPage() — the canonical way to open the
// extension's manifest-declared options_page in a new tab. Visible
// in BOTH the side-panel (account view) and the in-page modal so
// users always have one click away from the settings, regardless of
// which surface they're in.
// Embed-only shortcut to the Chrome side panel (history surface).
// chrome.sidePanel.open requires a recent user gesture and a windowId,
// neither of which we can resolve synchronously from inside the modal
// iframe — so we forward to the SW which queries the active window
// and calls open. Chrome 116+ propagates the gesture through
// chrome.runtime.sendMessage so the call is allowed.
function OpenSidePanelButton() {
  const T = useT()
  const open = () => {
    chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' }).catch((e) => {
      console.warn('[panel-header] OPEN_SIDE_PANEL message failed:', e?.message ?? e)
    })
  }
  return (
    <button
      type="button"
      onClick={open}
      title={T.panelHeader.openSidePanelTitle}
      aria-label={T.panelHeader.openSidePanelAria}
      className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition"
    >
      <SidePanelIcon />
    </button>
  )
}

// Heroicons-style outline: a panel with a vertical divider on its
// right edge — visual metaphor for "page + sidebar". Stroke width and
// rounding match the GearIcon language so the right cluster reads as
// a coherent group.
function SidePanelIcon() {
  return (
    <svg
      width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <line x1="15" y1="4.5" x2="15" y2="19.5" />
    </svg>
  )
}

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
      <div className="flex items-center gap-2.5 min-w-0">
        {user ? (
          <>
            <Avatar user={user} />
            <div className="flex flex-col min-w-0 leading-tight">
              <span className="text-xs font-semibold text-gray-900 truncate" title={user.email}>
                {user.email}
              </span>
              {isEmbed ? (
                // Embed (modal) mode: plan dot + label, optional MM:SS
                // remaining-quota chip when the free user is approaching
                // the wall. Account toggles (ON/OFF, logout) live in the
                // Chrome native side panel surface, not here.
                <span className="text-[11px] text-gray-500 flex items-center gap-1.5 mt-0.5">
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{
                      background: user.plan === 'pro' ? '#6366f1' : '#94a3b8',
                      boxShadow: user.plan === 'pro' ? '0 0 0 2px rgba(99,102,241,0.18)' : 'none',
                    }}
                  />
                  <span className={user.plan === 'pro' ? 'text-indigo-600 font-medium' : ''}>
                    {user.plan === 'pro' ? T.quota.plan_pro : T.quota.plan_free}
                  </span>
                  {showLiveRemaining && (
                    <span
                      className={`px-1.5 py-[1px] rounded font-mono tabular-nums text-[10px] font-medium ${remainingClass}`}
                      title={T.quota.remainingTooltip}
                    >
                      {T.panelHeader.remainingPrefix} {formatMmSs(liveRemainingSecs!)}
                    </span>
                  )}
                </span>
              ) : (
                // Side panel (account view): same identity card layout,
                // but the second line is a clickable plan + logout combo
                // (existing behaviour). The toggle / logout buttons in
                // the right cluster still cover the explicit cases.
                <button
                  type="button"
                  onClick={onLogout}
                  className="text-[11px] text-gray-500 hover:text-gray-700 text-left mt-0.5"
                  title={T.panelHeader.logoutTooltip}
                >
                  {interpolate(T.panelHeader.planLogoutCombo, {
                    plan: user.plan === 'pro' ? T.quota.plan_pro : T.quota.plan_free,
                  })}
                </button>
              )}
            </div>
          </>
        ) : (
          <span className="text-xs text-gray-500">{T.panelHeader.notLoggedIn}</span>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {isEmbed && typeof playbackSpeed === 'number' && typeof onSpeedChange === 'function' && (
          <SpeedSelector current={playbackSpeed} onChange={onSpeedChange} />
        )}
        {/* In-page modal only: shortcut to the Chrome side panel so
         *  the user can check past lectures without leaving the
         *  current video. Side-panel surface itself never needs to
         *  open itself, so we hide this in account view. */}
        {isEmbed && <OpenSidePanelButton />}
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
