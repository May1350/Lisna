import { useEffect, useState } from 'react'
import { getPlaybackSpeed, setPlaybackSpeed } from '../shared/storage'

const OPTIONS: Array<{ value: 'auto' | number; label: string }> = [
  { value: 'auto', label: 'プレイヤー最高速 (推奨)' },
  { value: 1.5, label: '1.5×' },
  { value: 2.0, label: '2.0×' },
  { value: 2.5, label: '2.5×' },
  { value: 3.0, label: '3.0×' },
]

export function Options() {
  const [speed, setSpeed] = useState<'auto' | number>('auto')
  useEffect(() => { getPlaybackSpeed().then(setSpeed) }, [])
  const onChange = async (v: 'auto' | number) => { setSpeed(v); await setPlaybackSpeed(v) }
  return (
    <div className="p-8 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold mb-6">Study-Helper 設定</h1>
      <h2 className="font-semibold mb-2">再生速度</h2>
      <p className="text-sm text-gray-600 mb-4">要約モード起動時に自動で適用される速度です。</p>
      {OPTIONS.map(o => (
        <label key={String(o.value)} className="flex gap-2 items-center mb-2">
          <input type="radio" name="speed" checked={speed === o.value} onChange={() => onChange(o.value)} />
          {o.label}
        </label>
      ))}
    </div>
  )
}
