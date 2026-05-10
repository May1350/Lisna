'use client'

import { useEffect } from 'react'

export default function PaymentSuccess() {
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
        background: '#1c1815',
        color: '#fbf6ec',
        fontSize: 28,
        lineHeight: '56px',
        marginBottom: 24,
      }}>
        ✓
      </div>
      <h1 style={{ fontSize: 24, marginBottom: 12 }}>Pro へようこそ</h1>
      <p style={{ fontSize: 15, color: '#475569', marginBottom: 24 }}>
        ご登録ありがとうございます。<br />
        Lisna に戻ると、月 30 時間の収録枠がご利用いただけます。
      </p>
      <p style={{ fontSize: 12, color: '#cbd5e1', marginTop: 40 }}>
        このタブは自動で閉じます。
      </p>
    </main>
  )
}
