import { useMemo, useState } from 'react'
import { ReactFlow, Background, Controls, MiniMap, Handle, Position, MarkerType } from '@xyflow/react'
import type { Node, Edge, NodeProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { FLOWS } from './registry'
import { Surface, SURFACE_DIMS } from './Surface'
import type { FlowScene, FlowSurface } from './types'

interface Props {
  flowId: string
  onSwitchFlow: (id: string) => void
}

// xyflow renders nodes positioned in canvas-space. We lay each scene
// out by hand (left-to-right, with vertical jogs for branches). Bench-
// marked: hand-laid is markedly clearer than dagre auto-layout when
// the graph is small (<25 nodes) and reads top-to-bottom.

const NODE_HMARGIN = 100 // canvas px of breathing room between nodes

export function FlowView({ flowId, onSwitchFlow }: Props) {
  const flow = FLOWS.find(f => f.id === flowId) ?? FLOWS[0]
  if (!flow) return <div className="p-10 text-ink-500">No flow registered.</div>

  const { width: sw, height: sh } = SURFACE_DIMS[flow.surface]
  // Default layout: scenes flow left to right. Custom layouts can be
  // expressed by attaching `x`/`y` to a scene; we use whatever the
  // scene file's positions array provides (see scenes/01-onboarding.ts).
  const positions = (flow as unknown as { positions?: Record<string, { x: number; y: number }> }).positions ?? {}

  const nodes: Node<SceneNodeData>[] = useMemo(() => {
    return flow.scenes.map((scene, i) => {
      const pos = positions[scene.id] ?? { x: i * (sw + NODE_HMARGIN), y: 0 }
      return {
        id: scene.id,
        type: 'sceneNode',
        position: pos,
        data: { scene, surface: flow.surface },
        // xyflow needs to know dimensions to draw edges that connect
        // to the node's bounding box — we pad a bit for the title.
        width: sw,
        height: sh + 60,
        // Stop the canvas from auto-fitting beyond our laid-out positions.
        draggable: true,
      } satisfies Node<SceneNodeData>
    })
  }, [flow, positions, sw, sh])

  const edges: Edge[] = useMemo(() => {
    const out: Edge[] = []
    for (const e of flow.edges) {
      // Two tiers, no decoration:
      //   primary path  → solid ink-900
      //   alt / error   → solid ink-500 (dimmer) — same shape, less weight
      // No animation, no color encoding, no label background pill —
      // the user said "as simple as possible", so we let the underlying
      // dotted canvas show through.
      const stroke = e.dashed ? '#94877a' : '#3d342a'
      out.push({
        id: `${e.from}->${e.to}:${e.label}`,
        source: e.from,
        target: e.to,
        label: e.label,
        labelStyle: {
          fontSize: 11,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fill: stroke,
        },
        // labelShowBg=false drops the cream pill behind the text.
        labelShowBg: false,
        style: { stroke, strokeWidth: 1 },
        markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 14, height: 14 },
      })
    }
    return out
  }, [flow.edges])

  return (
    <div className="w-screen" style={{ height: 'calc(100vh - 60px)' }}>
      <ReactFlow
        nodes={nodes as Node[]}
        edges={edges}
        nodeTypes={NODE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 0.8 }}
        minZoom={0.1}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#d8cdb8" gap={24} />
        <Controls position="top-right" showInteractive={false} />
        <MiniMap pannable zoomable nodeColor="#3d342a" maskColor="rgba(245,239,230,0.7)" position="bottom-right" />
        {/* Boundary stickers — show "leads to / comes from Flow X" links. */}
        {flow.boundaryLinks && flow.boundaryLinks.length > 0 && (
          <BoundaryPanel
            links={flow.boundaryLinks}
            onSwitchFlow={onSwitchFlow}
          />
        )}
      </ReactFlow>
    </div>
  )
}

interface SceneNodeData extends Record<string, unknown> {
  scene: FlowScene
  surface: FlowSurface
}

function SceneNode({ data }: NodeProps<Node<SceneNodeData>>) {
  const { scene, surface } = data
  const [variantIdx, setVariantIdx] = useState(0)
  const variants = scene.variants ?? null
  const renderFn = variants ? variants[variantIdx]?.render : scene.render
  const variantLabel = variants ? variants[variantIdx]?.label : null

  return (
    <div className="flex flex-col items-stretch">
      <Handle type="target" position={Position.Left} style={{ background: '#3d342a' }} />
      <div className="mb-2 px-1">
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-sm font-medium text-ink-900 truncate">{scene.label}</div>
          {scene.tags && (
            <div className="flex gap-1 flex-wrap">
              {scene.tags.map(t => (
                <span
                  key={t}
                  className={`text-[9px] font-mono uppercase px-1 rounded ${TAG_CLASSES[t] ?? 'bg-paper-300 text-ink-700'}`}
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
        {scene.caption && (
          <div className="text-[10px] text-ink-500 mt-0.5">{scene.caption}</div>
        )}
        {variants && variants.length > 1 && (
          <div className="flex items-center gap-1 mt-1">
            <button
              type="button"
              onClick={() => setVariantIdx(i => (i - 1 + variants.length) % variants.length)}
              className="text-[10px] px-1.5 py-0.5 border border-paper-edge rounded hover:bg-paper-200"
              title="Previous variant"
            >◂</button>
            <span className="text-[10px] font-mono text-ink-500">
              {variantIdx + 1}/{variants.length} · {variantLabel}
            </span>
            <button
              type="button"
              onClick={() => setVariantIdx(i => (i + 1) % variants.length)}
              className="text-[10px] px-1.5 py-0.5 border border-paper-edge rounded hover:bg-paper-200"
              title="Next variant"
            >▸</button>
          </div>
        )}
      </div>
      <Surface surface={surface}>{renderFn ? renderFn() : null}</Surface>
      <Handle type="source" position={Position.Right} style={{ background: '#3d342a' }} />
    </div>
  )
}

const NODE_TYPES = { sceneNode: SceneNode }

const TAG_CLASSES: Record<string, string> = {
  modal: 'bg-ink-900 text-paper-100',
  overlay: 'bg-ink-900 text-paper-100',
  transient: 'bg-warn-amber/30 text-ink-900',
  error: 'bg-warn-red/15 text-warn-red',
  success: 'bg-ok-green/15 text-ok-green',
  placeholder: 'bg-terra-tint text-terra-700',
}

function BoundaryPanel({
  links,
  onSwitchFlow,
}: {
  links: NonNullable<import('./types').FlowGraph['boundaryLinks']>
  onSwitchFlow: (id: string) => void
}) {
  return (
    <div className="absolute top-3 left-3 z-10 flex flex-col gap-1.5 bg-paper-100/95 backdrop-blur border border-paper-edge rounded-lg p-2 shadow-card max-w-[260px]">
      <div className="text-[10px] font-mono uppercase tracking-wider text-ink-500">Cross-flow links</div>
      {links.map((l, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onSwitchFlow(l.toFlowId)}
          className="text-left text-[11px] flex items-center gap-1.5 px-1.5 py-1 rounded hover:bg-paper-200"
        >
          <span className="text-terra">{l.direction === 'out' ? '→' : '←'}</span>
          <span className="font-mono">{l.label}</span>
          <span className="text-ink-500">·</span>
          <span className="text-ink-700 truncate">{l.toFlowId}</span>
        </button>
      ))}
    </div>
  )
}
