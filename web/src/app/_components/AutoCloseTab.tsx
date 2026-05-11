'use client'

import { useEffect, type CSSProperties, type ReactNode } from 'react'

// Variant-aware "auto-close" landing page used by the four Stripe
// redirect targets (/success, /cancel, /trial-success, /trial-cancel).
// Each page was a near-verbatim copy of this scaffold (same icon
// chrome, same useEffect to call window.close() after 1.5-2 s) —
// centralized here so the layout/colors/timing live in one place and
// the per-page files become 5-line prop bags.
//
// `window.close()` only works on tabs opened by JavaScript; Stripe-
// redirected tabs don't always qualify. We try anyway and silently
// leave the tab open if the browser refuses. The user can close
// manually — the footer copy hints at this.

interface Props {
  variant: 'success' | 'cancel'
  title: string
  body: ReactNode
  /** Optional middle paragraph (smaller, lighter color) — used on
   *  /trial-success to surface "no charge yet" reassurance. */
  subBody?: ReactNode
  /** Footer line shown at the bottom of the page. Defaults to a
   *  generic Japanese close-message. */
  footer?: string
  /** ms before attempting window.close(). Defaults to 2 s. */
  closeAfterMs?: number
}

const containerStyle: CSSProperties = {
  maxWidth: 480,
  margin: '0 auto',
  padding: '80px 24px',
  fontFamily: 'system-ui, sans-serif',
  lineHeight: 1.7,
  textAlign: 'center',
}

const iconBase: CSSProperties = {
  display: 'inline-block',
  width: 56,
  height: 56,
  borderRadius: 28,
  fontSize: 28,
  marginBottom: 24,
}

const successIconStyle: CSSProperties = {
  ...iconBase,
  background: '#1c1815',
  color: '#fbf6ec',
  lineHeight: '56px',
}

const cancelIconStyle: CSSProperties = {
  ...iconBase,
  background: '#f5efe6',
  border: '1px solid #d8cdb8',
  color: '#94877a',
  // The 1-px border eats 2 px of inner height; nudging line-height
  // by the same amount keeps the glyph optically centered.
  lineHeight: '54px',
}

const DEFAULT_FOOTER = 'このタブは自動で閉じます。'

export function AutoCloseTab({
  variant,
  title,
  body,
  subBody,
  footer = DEFAULT_FOOTER,
  closeAfterMs = 2000,
}: Props) {
  useEffect(() => {
    const t = window.setTimeout(() => {
      try { window.close() } catch { /* leave tab open */ }
    }, closeAfterMs)
    return () => window.clearTimeout(t)
  }, [closeAfterMs])

  return (
    <main style={containerStyle}>
      <div style={variant === 'success' ? successIconStyle : cancelIconStyle}>
        {variant === 'success' ? '✓' : '×'}
      </div>
      <h1 style={{ fontSize: 24, marginBottom: 12 }}>{title}</h1>
      <p style={{ fontSize: 15, color: '#475569', marginBottom: 24 }}>{body}</p>
      {subBody && <p style={{ fontSize: 13, color: '#94a3b8' }}>{subBody}</p>}
      <p style={{ fontSize: 12, color: '#cbd5e1', marginTop: 40 }}>{footer}</p>
    </main>
  )
}
