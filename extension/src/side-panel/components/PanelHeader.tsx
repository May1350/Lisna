import type { User } from '../../shared/types'
import type { DisplayMode } from '../../shared/storage'

interface Props {
  user: User | null
  mode: DisplayMode
  isPopout: boolean
  onSwitchMode: () => void
  onClose: () => void
  onLogout: () => void
}

export function PanelHeader({ user, isPopout, onSwitchMode, onClose, onLogout }: Props) {
  const switchLabel = isPopout ? '↩ サイドパネル' : '⤴ ポップアップ'
  const switchTitle = isPopout
    ? 'サイドパネルに戻す'
    : 'ポップアップウィンドウに切り替え'

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
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={onSwitchMode}
          title={switchTitle}
          className="text-[11px] px-2 py-1 rounded border border-gray-300 hover:bg-gray-100"
        >
          {switchLabel}
        </button>
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
