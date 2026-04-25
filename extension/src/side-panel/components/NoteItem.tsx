import { jumpToTimestamp } from '../api-client'
import type { NoteItem as N } from '../../shared/types'

function fmt(s: number): string {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60)
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

export function NoteItem({ n, slideUrl }: { n: N; slideUrl?: string }) {
  return (
    <button
      onClick={() => jumpToTimestamp(n.ts)}
      className={`block w-full text-left px-3 py-2 rounded hover:bg-gray-100 ${n.important ? 'border-l-4 border-red-500' : ''}`}
    >
      <div className="text-xs text-gray-500">[{fmt(n.ts)}]</div>
      <div className="text-sm">{n.important && '⭐ '}{n.text}</div>
      {slideUrl && <img src={slideUrl} alt="" className="mt-1 rounded max-w-full" />}
    </button>
  )
}
