import { useState } from 'react'
import { callApi } from '../api-client'

type Format = 'pdf' | 'markdown' | 'both'

interface FinalizeResponse {
  pdf_url?: string
  markdown_url?: string
  notes?: unknown
}

export function DownloadButton({ sessionId, title }: { sessionId: string; title: string }) {
  const [loading, setLoading] = useState(false)
  const [format, setFormat] = useState<Format>('pdf')

  const onClick = async () => {
    setLoading(true)
    try {
      const r = await callApi<FinalizeResponse>('/v1/session/finalize', 'POST', {
        session_id: sessionId,
        title,
        format,
      })
      if (r.pdf_url) window.open(r.pdf_url, '_blank')
      if (r.markdown_url) window.open(r.markdown_url, '_blank')
    } finally { setLoading(false) }
  }

  const label =
    format === 'pdf' ? '📥 ダウンロード (PDF)' :
    format === 'markdown' ? '📥 ダウンロード (Markdown)' :
    '📥 ダウンロード (PDF + Markdown)'

  return (
    <div className="mt-3 space-y-2">
      <fieldset className="flex gap-3 text-sm">
        <legend className="sr-only">形式を選択</legend>
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="radio"
            name="dl-format"
            value="pdf"
            checked={format === 'pdf'}
            onChange={() => setFormat('pdf')}
            disabled={loading}
          />
          <span>PDF</span>
        </label>
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="radio"
            name="dl-format"
            value="markdown"
            checked={format === 'markdown'}
            onChange={() => setFormat('markdown')}
            disabled={loading}
          />
          <span>Markdown</span>
        </label>
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="radio"
            name="dl-format"
            value="both"
            checked={format === 'both'}
            onChange={() => setFormat('both')}
            disabled={loading}
          />
          <span>両方</span>
        </label>
      </fieldset>
      <button
        onClick={onClick}
        disabled={loading}
        className="w-full bg-emerald-600 disabled:bg-gray-300 text-white py-2 rounded"
      >
        {loading ? '生成中...' : label}
      </button>
    </div>
  )
}
