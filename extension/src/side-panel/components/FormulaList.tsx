import type { OutlineFormula } from '../api-client'
import { TsButton } from './TsButton'

interface FormulaListProps {
  formulas: OutlineFormula[]
  onJump?: (ts: number) => void
}

export function FormulaList({ formulas, onJump }: FormulaListProps) {
  if (formulas.length === 0) return null
  return (
    <ul className="space-y-1.5">
      {formulas.map((f, i) => (
        <li key={`${f.expression.slice(0, 24)}-${i}`}
            className={`bg-paper-200 border border-paper-edge rounded-md-design px-2 py-1.5 text-xs ${f.from === 'inferred' ? 'formula-item inferred' : 'formula-item'}`}>
          {f.label && (
            <div className="text-[10px] font-mono uppercase tracking-eyebrow text-ink-500 font-semibold mb-0.5">
              {f.from === 'inferred' ? '※ ' : ''}{f.label}
            </div>
          )}
          <code className="font-mono text-ink-900 leading-relaxed">{f.expression}</code>
          {!f.label && f.from === 'inferred' && (
            <span className="ml-2 text-terra-700 font-mono">※</span>
          )}
          <div className="flex justify-end mt-0.5">
            <TsButton ts={f.ts} onJump={onJump} inferred={f.from === 'inferred'} />
          </div>
        </li>
      ))}
    </ul>
  )
}
