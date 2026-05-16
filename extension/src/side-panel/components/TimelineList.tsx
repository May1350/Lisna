import type { OutlineTimelineEvent } from '../api-client'
import { TsButton } from './TsButton'

interface TimelineListProps {
  events: OutlineTimelineEvent[]
  onJump?: (ts: number) => void
}

export function TimelineList({ events, onJump }: TimelineListProps) {
  if (events.length === 0) return null
  return (
    <ul className="space-y-1">
      {events.map((ev, i) => (
        <li key={`${ev.when}-${i}`}
            className={`text-xs leading-relaxed grid grid-cols-[auto_1fr_auto] gap-2 items-baseline ${ev.from === 'inferred' ? 'timeline-item inferred' : 'timeline-item'}`}>
          <span className="text-ink-500 font-mono tabular-nums shrink-0">
            {ev.from === 'inferred' ? '※ ' : ''}{ev.when}
          </span>
          <span className="text-ink-700">{ev.event}</span>
          <TsButton ts={ev.ts} onJump={onJump} inferred={ev.from === 'inferred'} />
        </li>
      ))}
    </ul>
  )
}
