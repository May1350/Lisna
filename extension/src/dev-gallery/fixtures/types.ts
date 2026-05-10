import type { ReactNode } from 'react'

/**
 * A single gallery frame.
 *
 * A fixture imports the *real* component and renders it with mock props.
 * Fixtures should NOT mock the component itself — that defeats the point.
 * If a component reads chrome.storage.local at module init, seed it via
 * the chrome-mock helpers in main.tsx (already done for common keys).
 */
export interface GalleryFixture {
  /** Unique slug; only used as React key + URL anchor. */
  id: string
  /** Top-level category — drives section headings and the filter dropdown. */
  category: string
  /** Short human label (≤ 60 chars). Shown above the frame. */
  label: string
  /** Optional: secondary annotation (e.g., "Pro plan, 95% quota"). */
  note?: string
  /** Render function. Called on every gallery render — keep it pure
   *  except for explicit useState/useEffect inside the component tree. */
  render: () => ReactNode
  /** Override frame width (px). When omitted, the gallery's global
   *  width selector applies. Useful for fixtures that demand a specific
   *  size to demonstrate (e.g., SectionRail dot-mode at 320px). */
  width?: number
  /** Override frame height (px). Useful for fixtures with intrinsic
   *  scrollable content (transcript, outline). Default 'auto' grows. */
  height?: number | 'auto'
  /** Override frame surface bg. Default paper-100 matches the side-panel. */
  surface?: 'paper-100' | 'paper-200' | 'ink-900'
}
