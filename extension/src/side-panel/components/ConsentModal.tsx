import { useState } from 'react'
import { useT } from '../../shared/i18n'

interface Props { onAccept: () => void }

export function ConsentModal({ onAccept }: Props) {
  const T = useT()
  const [a, setA] = useState(false)
  const [b, setB] = useState(false)
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl p-5 max-w-md max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-bold mb-2">{T.consent.title}</h2>
        <p className="text-sm text-gray-700 mb-3">
          {T.consent.body}
        </p>
        <ol className="text-sm text-gray-700 list-decimal pl-5 space-y-1 mb-3">
          <li>{T.consent.bullet_terms_institution}</li>
          <li>{T.consent.bullet_terms_content}</li>
          <li>{T.consent.bullet_terms_law}</li>
        </ol>
        <p className="text-sm font-semibold mb-3">
          {T.consent.disclaimer}
        </p>
        <label className="flex gap-2 items-start text-sm mb-2">
          <input type="checkbox" checked={a} onChange={e => setA(e.target.checked)} />
          {T.consent.agree}
        </label>
        <label className="flex gap-2 items-start text-sm mb-4">
          <input type="checkbox" checked={b} onChange={e => setB(e.target.checked)} />
          {T.consent.personalUse}
        </label>
        <button
          disabled={!(a && b)}
          onClick={onAccept}
          className="w-full bg-blue-600 disabled:bg-gray-300 text-white py-2 rounded"
        >{T.consent.accept}</button>
      </div>
    </div>
  )
}
