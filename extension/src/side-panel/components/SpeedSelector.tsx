import { useState } from 'react'
import { useT } from '../../shared/i18n'

const SPEEDS = [1, 1.5, 2, 2.5, 3, 4] as const

interface Props {
  current: number
  onChange: (speed: number) => void
}

export function SpeedSelector({ current, onChange }: Props) {
  const T = useT()
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="px-2 py-1 text-xs font-semibold rounded-md bg-paper-300 hover:bg-ink-200 text-ink-900 min-w-[40px]"
        title={T.speed.selectorTitle}
      >
        {current}×
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-paper-100 border border-paper-edge rounded-md shadow-lg py-1 z-50">
          {SPEEDS.map(s => (
            <button
              key={s}
              type="button"
              onClick={() => { onChange(s); setOpen(false) }}
              className={`block w-full text-left px-3 py-1 text-xs hover:bg-paper-300 ${current === s ? 'font-semibold text-ink-700' : 'text-ink-900'}`}
            >
              {s}×
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
