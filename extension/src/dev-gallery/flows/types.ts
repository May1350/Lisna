import type { ReactNode } from 'react'

/**
 * A single flow node — represents one user-facing screen state.
 * Unlike List-mode fixtures (which show isolated components), a Scene
 * renders the FULL composite the user sees: header, body, controls,
 * overlays, etc. as wired together by App.tsx for that state.
 */
export interface FlowScene {
  /** Unique within the flow. */
  id: string
  /** Short title shown above the scene preview in the canvas. */
  label: string
  /** Optional one-line description for hover/aside. */
  caption?: string
  /** Render the composite. The frame surrounding it is provided by
   *  the FlowView node — keep this rendering side-effect-free.
   *  If a scene has multiple sub-variants the user can cycle, return
   *  the variant array via `variants` instead and leave render undefined. */
  render?: () => ReactNode
  /** Variant cycle inside one scene — e.g., OutlineView at 2 sections,
   *  4 sections, 8 sections share the same logical state and shouldn't
   *  multiply the node count. */
  variants?: Array<{ label: string; render: () => ReactNode }>
  /** Annotations shown as small chips next to the label. */
  tags?: Array<'modal' | 'overlay' | 'transient' | 'error' | 'success' | 'placeholder'>
}

/** A directed edge between two scenes. The label is the user action /
 *  event that causes the transition. Keep labels short (3–10 chars). */
export interface FlowEdge {
  from: string
  to: string
  label: string
  /** When set, draw the edge dashed — for transient or error transitions. */
  dashed?: boolean
}

/** Cross-flow boundary link — leaves the current flow and enters
 *  another flow's named scene. Renders as a small sticker node at
 *  the boundary; clicking it switches the active flow tab. */
export interface FlowBoundaryLink {
  /** This flow's exit/entry scene id. */
  fromScene: string
  /** Target flow id (registered in flows/registry.ts). */
  toFlowId: string
  /** Target scene id inside the target flow (focused on switch). */
  toSceneId: string
  /** Action label, like a regular edge. */
  label: string
  /** Direction — this flow's scene is the SOURCE of the transition,
   *  or the DESTINATION (i.e., another flow leads in here). */
  direction: 'out' | 'in'
}

export type FlowSurface = 'embed' | 'side-panel' | 'options-page'

export interface FlowGraph {
  id: string
  label: string
  caption?: string
  /** Which Lisna surface this flow happens on. Determines the scene
   *  frame chrome (embed has the in-page modal header style;
   *  side-panel is the Chrome panel; options-page is the full-tab
   *  Options surface). */
  surface: FlowSurface
  scenes: FlowScene[]
  edges: FlowEdge[]
  boundaryLinks?: FlowBoundaryLink[]
}
