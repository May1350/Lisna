'use client'

import { useEffect } from 'react'

export default function TrialSuccess() {
  useEffect(() => {
    // Stripe redirected here from a Checkout Session (mode=setup) the
    // extension opened in a NEW tab. The extension's visibilitychange
    // handler picks up `chrome.storage.local["sh.pendingTrialSession"]`
    // and calls /v1/trial/confirm as soon as the user returns. Best UX:
    // close this tab automatically so the user lands back on the
    // extension immediately — but window.close() only works on tabs
    // opened by JS, and Stripe-redirected tabs don't qualify in every
    // browser. We try anyway; if it fails the user closes manually.
    const t = window.setTimeout(() => {
      try { window.close() } catch { /* leave tab open */ }
    }, 1500)
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
        background: '#1c1815',
        color: '#fbf6ec',
        fontSize: 28,
        lineHeight: '56px',
        marginBottom: 24,
      }}>
        ✓
      </div>
      <h1 style={{ fontSize: 24, marginBottom: 12 }}>準備完了です</h1>
      <p style={{ fontSize: 15, color: '#475569', marginBottom: 24 }}>
        2 時間の無料トライアルが有効になりました。<br />
        このタブを閉じて、Lisna に戻ってください。
      </p>
      <p style={{ fontSize: 13, color: '#94a3b8' }}>
        今すぐ請求はありません ・ 2 時間後に Pro 加入の選択肢が表示されます
      </p>
      <p style={{ fontSize: 12, color: '#cbd5e1', marginTop: 40 }}>
        このページは自動で閉じます。閉じない場合は手動で閉じてください。
      </p>
    </main>
  )
}
