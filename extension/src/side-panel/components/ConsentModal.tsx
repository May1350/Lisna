import { useState } from 'react'

interface Props { onAccept: () => void }

export function ConsentModal({ onAccept }: Props) {
  const [a, setA] = useState(false)
  const [b, setB] = useState(false)
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl p-5 max-w-md max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-bold mb-2">重要なお知らせ</h2>
        <p className="text-sm text-gray-700 mb-3">
          本ツールは、ユーザーが視聴中の動画から音声・映像情報を取得し、AI で要約します。
          視聴コンテンツの著作権は配信元(教育機関、講師、配信プラットフォーム等)に帰属します。
        </p>
        <ol className="text-sm text-gray-700 list-decimal pl-5 space-y-1 mb-3">
          <li>所属機関(大学・予備校等)の利用規約および学則</li>
          <li>視聴対象コンテンツの利用規約</li>
          <li>著作権法その他関連法令</li>
        </ol>
        <p className="text-sm font-semibold mb-3">
          本ツールの使用により発生したいかなる紛争・損害についても、開発者は一切の責任を負いません。
        </p>
        <label className="flex gap-2 items-start text-sm mb-2">
          <input type="checkbox" checked={a} onChange={e => setA(e.target.checked)} />
          上記に同意します
        </label>
        <label className="flex gap-2 items-start text-sm mb-4">
          <input type="checkbox" checked={b} onChange={e => setB(e.target.checked)} />
          本ツールを個人の学習目的のみに使用します
        </label>
        <button
          disabled={!(a && b)}
          onClick={onAccept}
          className="w-full bg-blue-600 disabled:bg-gray-300 text-white py-2 rounded"
        >同意して始める</button>
      </div>
    </div>
  )
}
