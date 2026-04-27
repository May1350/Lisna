import { useState } from 'react'

interface Props {
  onStop: () => void
  disabled?: boolean
}

export function StopButton({ onStop, disabled = false }: Props) {
  const [confirming, setConfirming] = useState(false)

  if (confirming) {
    return (
      <div className="rounded border border-gray-300 bg-white p-3 text-sm">
        <p className="mb-3 text-gray-800">
          セッションを停止しますか? ノートは保存されます。
        </p>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="px-3 py-1 rounded border border-gray-300 hover:bg-gray-50"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={() => { setConfirming(false); onStop() }}
            className="px-3 py-1 rounded bg-red-600 text-white hover:bg-red-700"
          >
            停止する
          </button>
        </div>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      disabled={disabled}
      className="w-full px-3 py-2 rounded border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
    >
      ⏹ 停止
    </button>
  )
}
