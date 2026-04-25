import { useState } from 'react'
import { login } from '../api-client'

export function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const handle = async () => {
    setLoading(true); setErr(null)
    try { await login(); onSuccess() }
    catch (e) { setErr(e instanceof Error ? e.message : 'unknown') }
    finally { setLoading(false) }
  }
  return (
    <div className="p-6 text-center">
      <h2 className="text-lg font-bold mb-3">Study-Helper</h2>
      <p className="text-sm text-gray-600 mb-4">講義動画をリアルタイムで要約します</p>
      <button onClick={handle} disabled={loading} className="bg-blue-600 text-white px-4 py-2 rounded">
        {loading ? '...' : 'Google でログイン'}
      </button>
      {err && <p className="text-red-600 text-sm mt-3">{err}</p>}
    </div>
  )
}
