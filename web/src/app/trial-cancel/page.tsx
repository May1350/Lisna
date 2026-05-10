'use client'

import { useEffect } from 'react'

export default function TrialCancel() {
  useEffect(() => {
    const t = window.setTimeout(() => {
      try { window.close() } catch { /* leave tab open */ }
    }, 2000)
    return () => window.clearTimeout(t)
  }, [])

  return (
    <main style={{
      maxWidth: 480,
      margin: '0 auto',
      padding: '80px 24px',
      fontFamily: 'system-ui, sans-serif',
      lineHeight: 1.7,
      textAlign: 'center',
    }}>
      <div style={{
        display: 'inline-block',
        width: 56,
        height: 56,
        borderRadius: 28,
        background: '#f5efe6',
        border: '1px solid #d8cdb8',
        color: '#94877a',
        fontSize: 28,
        lineHeight: '54px',
        marginBottom: 24,
      }}>
        ×
      </div>
      <h1 style={{ fontSize: 24, marginBottom: 12 }}>トライアルは開始されませんでした</h1>
      <p style={{ fontSize: 15, color: '#475569', marginBottom: 24 }}>
        カード情報の登録がキャンセルされました。<br />
        Lisna に戻って、いつでもやり直せます。
      </p>
      <p style={{ fontSize: 12, color: '#cbd5e1', marginTop: 40 }}>
        このタブは自動で閉じます。
      </p>
    </main>
  )
}
