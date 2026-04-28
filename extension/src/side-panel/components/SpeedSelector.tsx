import { useState } from 'react'

const SPEEDS = [1, 1.5, 2, 2.5, 3, 4] as const

interface Props {
  current: number
  onChange: (speed: number) => void
}

export function SpeedSelector({ current, onChange }: Props) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="px-2 py-1 text-xs font-semibold rounded-md bg-gray-100 hover:bg-gray-200 text-gray-800 min-w-[40px]"
        title="再生速度"
      >
        {current}×
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg py-1 z-50">
          {SPEEDS.map(s => (
            <button
              key={s}
              type="button"
              onClick={() => { onChange(s); setOpen(false) }}
              className={`block w-full text-left px-3 py-1 text-xs hover:bg-gray-100 ${current === s ? 'font-semibold text-blue-600' : 'text-gray-800'}`}
            >
              {s}×
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
