import type { OutlineChainLink } from '../api-client'
import { TsButton } from './TsButton'

interface ChainListProps {
  links: OutlineChainLink[]
  onJump?: (ts: number) => void
}

export function ChainList({ links, onJump }: ChainListProps) {
  if (links.length === 0) return null
  return (
    <ul className="space-y-1">
      {links.map((l, i) => (
        <li
          key={`${l.text.slice(0, 24)}-${i}`}
          className={`text-xs leading-relaxed flex gap-2 items-baseline ${l.from === 'inferred' ? 'chain-link inferred' : 'chain-link'}`}
        >
          <span className="chain-link-glyph text-ink-300 shrink-0" aria-hidden>
            {l.from === 'inferred' ? '※' : '→'}
          </span>
          <span className="text-ink-700 flex-1">{l.text}</span>
          <TsButton ts={l.ts} onJump={onJump} inferred={l.from === 'inferred'} />
        </li>
      ))}
    </ul>
  )
}
