import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Frame } from './Frame'
import { fixtures } from './fixtures'
import type { GalleryFixture } from './fixtures/types'
import { FlowView } from './flows/FlowView'
import { FLOWS } from './flows/registry'

type WidthChoice = 320 | 380 | 460 | 560 | 'all'
type ViewMode = 'list' | 'flow'

const ALL_WIDTHS: Array<320 | 380 | 460 | 560> = [320, 380, 460, 560]

export function Gallery() {
  const [view, setView] = useState<ViewMode>('list')
  const [activeFlowId, setActiveFlowId] = useState<string>(FLOWS[0]?.id ?? '')
  const [widthChoice, setWidthChoice] = useState<WidthChoice>(380)
  const [filter, setFilter] = useState('')
  const [activeCategory, setActiveCategory] = useState<string | 'all'>('all')

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const f of fixtures) set.add(f.category)
    return ['all', ...Array.from(set)]
  }, [])

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return fixtures.filter(f => {
      if (activeCategory !== 'all' && f.category !== activeCategory) return false
      if (q && !f.label.toLowerCase().includes(q) && !f.category.toLowerCase().includes(q)) return false
      return true
    })
  }, [filter, activeCategory])

  return (
    <div className="min-h-screen bg-paper-200 text-ink-900">
      <header className="sticky top-0 z-40 backdrop-blur bg-paper-100/90 border-b border-paper-edge">
        <div className="max-w-[1800px] mx-auto px-6 py-3 flex flex-wrap items-center gap-3">
          <div className="flex items-baseline gap-2 mr-4">
            <span className="text-base font-semibold tracking-tight">Lisna · Dev Gallery</span>
            <span className="text-[10px] font-mono uppercase tracking-wider text-ink-500">
              {view === 'list' ? `${visible.length}/${fixtures.length} frames` : `${FLOWS.length} flows`}
            </span>
          </div>

          {/* View toggle — List for token/regression review, Flow for UX state-machine review. */}
          <div className="flex items-center gap-1 mr-2">
            {(['list', 'flow'] as ViewMode[]).map(m => (
              <button
                key={m}
                type="button"
                onClick={() => setView(m)}
                className={`text-[11px] font-mono px-2 py-1 rounded border transition uppercase tracking-wider ${
                  view === m
                    ? 'border-ink-900 bg-ink-900 text-paper-100'
                    : 'border-paper-edge text-ink-700 hover:border-ink-300'
                }`}
              >
                {m}
              </button>
            ))}
          </div>

          {view === 'list' ? (
            <>
              <div className="flex items-center gap-1">
                {([320, 380, 460, 560, 'all'] as WidthChoice[]).map(w => (
                  <button
                    key={String(w)}
                    type="button"
                    onClick={() => setWidthChoice(w)}
                    className={`text-[11px] font-mono px-2 py-1 rounded border transition ${
                      widthChoice === w
                        ? 'border-ink-900 bg-ink-900 text-paper-100'
                        : 'border-paper-edge text-ink-700 hover:border-ink-300'
                    }`}
                  >
                    {w === 'all' ? 'all-widths' : `${w}px`}
                  </button>
                ))}
              </div>
              <input
                value={filter}
                onChange={e => setFilter(e.target.value)}
                placeholder="filter…"
                className="ml-auto px-2 py-1 text-xs rounded border border-paper-edge bg-paper-100 focus:outline-none focus:border-ink-900 w-48"
              />
              <select
                value={activeCategory}
                onChange={e => setActiveCategory(e.target.value)}
                className="px-2 py-1 text-xs rounded border border-paper-edge bg-paper-100 focus:outline-none focus:border-ink-900"
              >
                {categories.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </>
          ) : (
            <div className="flex items-center gap-1 flex-wrap">
              {FLOWS.map(f => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setActiveFlowId(f.id)}
                  className={`text-[11px] px-2 py-1 rounded border transition ${
                    activeFlowId === f.id
                      ? 'border-ink-900 bg-ink-900 text-paper-100'
                      : 'border-paper-edge text-ink-700 hover:border-ink-300'
                  }`}
                  title={f.surface ? `Surface: ${f.surface}` : undefined}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      {view === 'flow' ? (
        <FlowView flowId={activeFlowId} onSwitchFlow={setActiveFlowId} />
      ) : (
      <main className="max-w-[1800px] mx-auto px-6 py-6">
        {groupByCategory(visible).map(group => (
          <section key={group.category} className="mb-12">
            <h2 className="text-[10px] font-mono uppercase tracking-wider text-ink-500 mb-3">
              {group.category} · {group.items.length}
            </h2>
            <div className="flex flex-wrap gap-6 items-start">
              {group.items.map(f =>
                widthChoice === 'all' ? (
                  <div key={f.id} className="flex gap-4 items-start">
                    {ALL_WIDTHS.map(w => (
                      <FixtureFrame key={`${f.id}-${w}`} fixture={f} width={w} />
                    ))}
                  </div>
                ) : (
                  <FixtureFrame key={f.id} fixture={f} width={widthChoice} />
                )
              )}
            </div>
          </section>
        ))}
        {visible.length === 0 && (
          <div className="text-center text-ink-500 text-sm py-20">
            No fixtures match the current filter.
          </div>
        )}
      </main>
      )}
    </div>
  )
}

function FixtureFrame({ fixture, width }: { fixture: GalleryFixture; width: number }) {
  return (
    <Frame
      label={fixture.label}
      category={fixture.category}
      width={fixture.width ?? width}
      height={fixture.height ?? 'auto'}
      surface={fixture.surface}
      note={fixture.note}
    >
      <SafeRender fixture={fixture} />
    </Frame>
  )
}

function SafeRender({ fixture }: { fixture: GalleryFixture }): ReactNode {
  // Each fixture renders an isolated React subtree; bugs in one fixture
  // shouldn't blank the whole gallery. We catch synchronously by guarding
  // the call. (React error boundaries would catch render-time throws,
  // but we don't bother adding a per-frame boundary here since the dev
  // overlay is fine for the gallery use case.)
  try {
    return fixture.render()
  } catch (err) {
    return (
      <div className="p-4 text-xs text-warn-red">
        Render error: {err instanceof Error ? err.message : String(err)}
      </div>
    )
  }
}

function groupByCategory(items: GalleryFixture[]): Array<{ category: string; items: GalleryFixture[] }> {
  const map = new Map<string, GalleryFixture[]>()
  for (const f of items) {
    const arr = map.get(f.category) ?? []
    arr.push(f)
    map.set(f.category, arr)
  }
  return Array.from(map.entries()).map(([category, items]) => ({ category, items }))
}
