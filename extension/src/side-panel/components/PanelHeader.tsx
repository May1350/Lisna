import type { User } from '../../shared/types'

interface Props {
  user: User | null
  /** True when this app is rendering inside the popout window. */
  isPopout: boolean
  /** Only used in side-panel (account) view. */
  enabled?: boolean
  /** Only used in side-panel (account) view. */
  onToggleEnabled?: (next: boolean) => void
  onClose: () => void
  onLogout: () => void
}

export function PanelHeader({
  user,
  isPopout,
  enabled,
  onToggleEnabled,
  onClose,
  onLogout,
}: Props) {
  const isAccountView = !isPopout
  const showToggle =
    isAccountView && typeof enabled === 'boolean' && typeof onToggleEnabled === 'function'

  return (
    <header className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-200 bg-white">
      <div className="flex flex-col min-w-0">
        {user ? (
          <>
            <span className="text-xs font-semibold text-gray-900 truncate" title={user.email}>
              👤 {user.email}
            </span>
            <button
              type="button"
              onClick={onLogout}
              className="text-[11px] text-gray-500 hover:text-gray-700 text-left"
              title="ログアウト"
            >
              {user.plan === 'pro' ? 'Pro プラン' : 'Free プラン'} · ログアウト
            </button>
          </>
        ) : (
          <span className="text-xs text-gray-500">未ログイン</span>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {showToggle && (
          <label
            className="flex items-center gap-1.5 text-[11px] text-gray-700 cursor-pointer select-none"
            title={enabled ? 'OFF にする' : 'ON にする'}
          >
            <span className="font-medium">{enabled ? 'ON' : 'OFF'}</span>
            <input
              type="checkbox"
              role="switch"
              aria-label="拡張機能の有効/無効"
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
          title="閉じる"
          aria-label="閉じる"
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 text-gray-600"
        >
          ✕
        </button>
      </div>
    </header>
  )
}
