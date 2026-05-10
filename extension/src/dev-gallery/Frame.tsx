import { useState, type ReactNode } from 'react'

export type FrameWidth = 320 | 380 | 460 | 560

interface FrameProps {
  label: string
  category?: string
  width?: number
  height?: number | 'auto'
  /** Background of the frame interior. The real side-panel is paper-100. */
  surface?: 'paper-100' | 'paper-200' | 'ink-900'
  /** Overlay note shown below the label (e.g., "Pro plan, 95% quota"). */
  note?: string
  children: ReactNode
}

export function Frame({
  label,
  category,
  width = 380,
  height = 'auto',
  surface = 'paper-100',
  note,
  children,
}: FrameProps) {
  const [collapsed, setCollapsed] = useState(false)
  const surfaceClass =
    surface === 'paper-200' ? 'bg-paper-200' : surface === 'ink-900' ? 'bg-ink-900' : 'bg-paper-100'

  return (
    <div className="flex flex-col">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <div className="min-w-0">
          <div className="text-[10px] font-mono uppercase tracking-wider text-ink-500">
            {category ?? '—'}
          </div>
          <div className="text-sm font-medium text-ink-900 truncate">{label}</div>
          {note ? (
            <div className="text-[11px] text-ink-500 mt-0.5">{note}</div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setCollapsed(c => !c)}
          className="text-[10px] font-mono text-ink-500 hover:text-ink-900 px-1.5 py-0.5 border border-paper-edge rounded"
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? '▸' : '▾'}
        </button>
      </div>
      {!collapsed && (
        <div
          className={`gallery-frame relative ${surfaceClass} border border-paper-edge rounded-[14px] shadow-card overflow-hidden`}
          // `transform: translateZ(0)` makes this div the containing block
          // for `position: fixed` descendants (per CSS Containment & the
          // "transformed ancestor" rule). Without this, ConsentModal's
          // fixed inset-0 overlay would cover the whole viewport and
          // ErrorToast would dock at the page bottom instead of the
          // frame bottom — both of which would make the gallery
          // unusable. `contain: paint` belt-and-suspenders.
          style={{
            width,
            height: height === 'auto' ? undefined : height,
            minHeight: height === 'auto' ? 200 : undefined,
            transform: 'translateZ(0)',
            contain: 'paint',
          }}
        >
          <div className="absolute top-1 right-1 z-50 text-[9px] font-mono text-ink-300 bg-paper-100/80 px-1 rounded pointer-events-none">
            {width}px
          </div>
          {/* The side-panel root is a flex column; we mimic that container here so
              components like App.tsx that assume flex-col fill behave naturally. */}
          <div className="flex flex-col w-full h-full">
            {children}
          </div>
        </div>
      )}
    </div>
  )
}
