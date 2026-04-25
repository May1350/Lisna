import { NoteItem } from './NoteItem'
import type { NoteItem as N, SlideItem } from '../../shared/types'

export function NoteList({ notes, slides }: { notes: N[]; slides: SlideItem[] }) {
  const slideByTs = new Map(slides.map(s => [Math.round(s.ts), s.key]))
  return (
    <div className="space-y-1">
      {notes.length === 0 && <p className="text-sm text-gray-500 p-3">処理中... 講義を再生してください。</p>}
      {notes.map((n, i) => (
        <NoteItem key={i} n={n} slideUrl={slideByTs.get(Math.round(n.ts))} />
      ))}
    </div>
  )
}
