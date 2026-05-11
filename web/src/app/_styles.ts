import type { CSSProperties } from 'react'

// Shared layout for the legal / pricing / refunds long-form pages.
// All public pages render their body inside a 720-px-wide column with
// system fonts and generous line-height. Inlined per-page previously,
// drifted into 5 verbatim copies — centralized here so the next
// design-token change touches one place.
export const containerStyle: CSSProperties = {
  maxWidth: 720,
  margin: '0 auto',
  padding: '40px 24px',
  fontFamily: 'system-ui, sans-serif',
  lineHeight: 1.7,
}
