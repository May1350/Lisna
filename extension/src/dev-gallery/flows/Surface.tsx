import type { ReactNode } from 'react'
import type { FlowSurface } from './types'

// Width × height presets per surface — chosen to match the shipping
// product. Embed = in-page modal default min(viewport*0.32, 480) ≈ 380.
// Side-panel = Chrome's user-resizable panel, default ~360. Options =
// full-tab page; we cap at a reasonable inner width so the canvas
// nodes don't blow out.
export const SURFACE_DIMS: Record<FlowSurface, { width: number; height: number }> = {
  embed: { width: 380, height: 640 },
  'side-panel': { width: 360, height: 640 },
  'options-page': { width: 720, height: 720 },
}

interface Props {
  surface: FlowSurface
  children: ReactNode
}

/**
 * Wraps a scene in the visual chrome appropriate for its surface.
 * Same `transform: translateZ(0)` containing-block trick as the
 * List-view Frame, so position-fixed children (modals, toasts) stay
 * inside the scene preview instead of escaping into the page.
 */
export function Surface({ surface, children }: Props) {
  const { width, height } = SURFACE_DIMS[surface]
  return (
    <div
      className="gallery-frame relative bg-paper-100 border border-paper-edge rounded-[14px] shadow-card overflow-hidden"
      style={{
        width,
        height,
        transform: 'translateZ(0)',
        contain: 'paint',
      }}
    >
      <div className="absolute top-1 right-1 z-50 text-[9px] font-mono text-ink-300 bg-paper-100/80 px-1 rounded pointer-events-none">
        {surface} · {width}×{height}
      </div>
      <div className="flex flex-col w-full h-full">
        {children}
      </div>
    </div>
  )
}
