import { useEffect, useState } from 'react'
import {
  getPlaybackSpeed,
  setPlaybackSpeed,
  getDisplayMode,
  setDisplayMode,
  type DisplayMode,
} from '../shared/storage'

const SPEED_OPTIONS: Array<{ value: 'auto' | number; label: string }> = [
  { value: 'auto', label: 'プレイヤー最高速 (推奨)' },
  { value: 1.5, label: '1.5×' },
  { value: 2.0, label: '2.0×' },
  { value: 2.5, label: '2.5×' },
  { value: 3.0, label: '3.0×' },
]

const DISPLAY_OPTIONS: Array<{ value: DisplayMode; label: string; hint?: string }> = [
  { value: 'side-panel', label: 'サイドパネル (Chrome 標準)' },
  { value: 'popout', label: 'ポップアップウィンドウ', hint: '画面の比率を保ちます' },
]

export function Options() {
  const [speed, setSpeed] = useState<'auto' | number>('auto')
  const [mode, setMode] = useState<DisplayMode>('side-panel')
  const [loggingOut, setLoggingOut] = useState(false)

  useEffect(() => {
    void getPlaybackSpeed().then(setSpeed)
    void getDisplayMode().then(setMode)
  }, [])

  const onSpeedChange = async (v: 'auto' | number) => {
    setSpeed(v)
    await setPlaybackSpeed(v)
  }
  const onModeChange = async (v: DisplayMode) => {
    setMode(v)
    await setDisplayMode(v)
  }
  const onLogout = async () => {
    setLoggingOut(true)
    try {
      await chrome.runtime.sendMessage({ type: 'AUTH_LOGOUT' })
      alert('ログアウトしました。')
    } finally {
      setLoggingOut(false)
    }
  }

  return (
    <div className="p-8 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold mb-6">Study-Helper 設定</h1>

      <section className="mb-8">
        <h2 className="font-semibold mb-2">再生速度</h2>
        <p className="text-sm text-gray-600 mb-4">要約モード起動時に自動で適用される速度です。</p>
        {SPEED_OPTIONS.map(o => (
          <label key={String(o.value)} className="flex gap-2 items-center mb-2">
            <input
              type="radio"
              name="speed"
              checked={speed === o.value}
              onChange={() => onSpeedChange(o.value)}
            />
            {o.label}
          </label>
        ))}
      </section>

      <section className="mb-8">
        <h2 className="font-semibold mb-2">表示モード</h2>
        <p className="text-sm text-gray-600 mb-4">
          要約セッション時にノートをどこに表示するかを選びます。
        </p>
        {DISPLAY_OPTIONS.map(o => (
          <label key={o.value} className="flex gap-2 items-start mb-2">
            <input
              type="radio"
              name="display-mode"
              className="mt-1"
              checked={mode === o.value}
              onChange={() => onModeChange(o.value)}
            />
            <span>
              <span>{o.label}</span>
              {o.hint && <span className="block text-xs text-gray-500">{o.hint}</span>}
            </span>
          </label>
        ))}
      </section>

      <section>
        <h2 className="font-semibold mb-2">アカウント</h2>
        <button
          type="button"
          onClick={onLogout}
          disabled={loggingOut}
          className="px-4 py-2 rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
        >
          {loggingOut ? 'ログアウト中…' : 'ログアウト'}
        </button>
      </section>
    </div>
  )
}
