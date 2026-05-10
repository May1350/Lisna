import { useState } from 'react'
import { useT } from '../../shared/i18n'

interface Props { onAccept: () => void }

export function ConsentModal({ onAccept }: Props) {
  const T = useT()
  const [a, setA] = useState(false)
  const [b, setB] = useState(false)
  return (
    <div className="fixed inset-0 bg-ink-900/50 flex items-center justify-center z-50 p-4">
      <div className="bg-paper-100 rounded-[14px] p-5 max-w-md max-h-[90vh] overflow-y-auto border border-paper-edge shadow-modal">
        <h2 className="text-lg font-bold mb-2 text-ink-900 tracking-headline-tight">{T.consent.title}</h2>
        <p className="text-sm text-ink-700 mb-3 leading-relaxed">
          {T.consent.body}
        </p>
        <ol className="text-sm text-ink-700 list-decimal pl-5 space-y-1 mb-3 leading-relaxed">
          <li>{T.consent.bullet_terms_institution}</li>
          <li>{T.consent.bullet_terms_content}</li>
          <li>{T.consent.bullet_terms_law}</li>
        </ol>
        <p className="text-sm font-semibold mb-3 text-ink-900">
          {T.consent.disclaimer}
        </p>
        <label className="flex gap-2 items-start text-sm mb-2 text-ink-900">
          <input type="checkbox" checked={a} onChange={e => setA(e.target.checked)} className="accent-terra mt-0.5" />
          {T.consent.agree}
        </label>
        <label className="flex gap-2 items-start text-sm mb-4 text-ink-900">
          <input type="checkbox" checked={b} onChange={e => setB(e.target.checked)} className="accent-terra mt-0.5" />
          {T.consent.personalUse}
        </label>
        <button
          disabled={!(a && b)}
          onClick={onAccept}
          className="w-full bg-ink-900 hover:bg-ink-700 disabled:bg-ink-200 disabled:cursor-not-allowed text-paper-100 py-2.5 rounded-[10px] font-medium transition-colors"
        >{T.consent.accept}</button>
      </div>
    </div>
  )
}
