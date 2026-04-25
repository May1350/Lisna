import { useState } from 'react'
import { callApi } from '../api-client'

export function DownloadButton({ sessionId, title }: { sessionId: string; title: string }) {
  const [loading, setLoading] = useState(false)
  const onClick = async () => {
    setLoading(true)
    try {
      const r = await callApi<{ pdf_url: string }>('/v1/session/finalize', 'POST', { session_id: sessionId, title })
      window.open(r.pdf_url, '_blank')
    } finally { setLoading(false) }
  }
  return (
    <button onClick={onClick} disabled={loading}
      className="w-full bg-emerald-600 disabled:bg-gray-300 text-white py-2 rounded mt-3">
      {loading ? '生成中...' : '📥 ダウンロード (PDF)'}
    </button>
  )
}
