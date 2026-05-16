import type { OutlineStep } from '../api-client'
import { TsButton } from './TsButton'

interface StepListProps {
  steps: OutlineStep[]
  onJump?: (ts: number) => void
  compact?: boolean
}

export function StepList({ steps, onJump, compact = false }: StepListProps) {
  // compact: important steps only (same filter rule as points)
  const visible = compact ? steps.filter(s => s.important) : steps
  if (visible.length === 0) return null

  return (
    <ol className="space-y-1 list-decimal pl-4">
      {visible.map((s, i) => (
        <li
          key={`${s.text.slice(0, 24)}-${i}`}
          className={`text-xs leading-relaxed flex gap-2 items-baseline ${s.from === 'inferred' ? 'step inferred' : 'step'}`}
        >
          {s.from === 'inferred' ? (
            <span className="bullet-mark" aria-hidden>※</span>
          ) : null}
          <span className={s.important ? 'text-ink-900 font-medium flex-1' : 'text-ink-700 flex-1'}>
            {s.text}
          </span>
          <TsButton ts={s.ts} onJump={onJump} inferred={s.from === 'inferred'} />
        </li>
      ))}
    </ol>
  )
}
