import { useEffect, useRef, useState } from 'react'
import type { Outline, OutlineSection } from '../api-client'

// Renders the curated lecture outline produced by the backend's curator
// pass. The outline is REPLACED on every curator run (every ~30 s of
// lecture audio), so the UI naturally evolves: early in the lecture there
// might be a single section with a brief summary, and as more audio is
// transcribed the curator adds key terms, examples, and reorganises
// sections into the right hierarchy.
//
// Visual hierarchy:
//   Lecture title (h2)
//   └─ Section heading (h3) + start timestamp
//      ├─ Section summary (1-2 line italic prose)
//      ├─ Key terms (tinted card with definition)
//      ├─ Examples (bullet, neutral)
//      └─ Points (bullet; ★ prefix when important)
//
// Empty state matches what the user has always seen: 「処理中... 講義を再生してください。」
// — preserved because the curator only fires after the first transcript
// arrives, so the modal still feels alive while the first chunk uploads.

function fmtTs(secs: number): string {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = Math.floor(secs % 60)
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

interface Props {
  outline: Outline | null
  onJump?: (ts: number) => void
}

export function OutlineView({ outline, onJump }: Props) {
  // Track "the outline was just refreshed" so we can flash a brief visual
  // signal — the curator rewrites the whole document each run, and without
  // a cue the user can't tell that earlier sections were just rewritten.
  // We compare a serialised snapshot of the outline against the previous
  // render to detect actual changes (vs no-op WS messages).
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null)
  const lastSerialisedRef = useRef<string>('')
  useEffect(() => {
    if (!outline) return
    const serialised = JSON.stringify(outline)
    if (serialised === lastSerialisedRef.current) return
    lastSerialisedRef.current = serialised
    setRefreshedAt(Date.now())
  }, [outline])

  // Auto-clear the flash class after the animation has played so future
  // updates re-trigger it.
  const [flashing, setFlashing] = useState(false)
  useEffect(() => {
    if (refreshedAt === null) return
    setFlashing(true)
    const t = window.setTimeout(() => setFlashing(false), 800)
    return () => window.clearTimeout(t)
  }, [refreshedAt])

  if (!outline || outline.sections.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto px-3 py-4">
        <p className="text-sm text-gray-500">処理中... 講義を再生してください。</p>
      </div>
    )
  }

  return (
    <div className={`flex-1 overflow-y-auto px-3 py-3 space-y-4 transition-colors duration-700 ${flashing ? 'bg-blue-50/60' : 'bg-transparent'}`}>
      <div className="flex items-baseline justify-between gap-2">
        {outline.title && (
          <h2 className="text-base font-bold text-gray-900 leading-snug">
            {outline.title}
          </h2>
        )}
        {refreshedAt !== null && (
          <RefreshIndicator at={refreshedAt} />
        )}
      </div>
      {outline.sections.map((section, i) => (
        <SectionBlock key={`${section.heading}-${i}`} section={section} onJump={onJump} />
      ))}
    </div>
  )
}

// Renders "X seconds ago" / "X分前" relative to the last refresh. Updates
// every 5 s so it stays vaguely current without re-rendering constantly.
function RefreshIndicator({ at }: { at: number }) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setTick(t => t + 1), 5000)
    return () => window.clearInterval(id)
  }, [])
  const ago = Math.floor((Date.now() - at) / 1000)
  let label: string
  if (ago < 5) label = '更新したて'
  else if (ago < 60) label = `${ago}秒前に更新`
  else label = `${Math.floor(ago / 60)}分前に更新`
  return (
    <span
      className="text-[10px] text-blue-500 font-medium shrink-0 whitespace-nowrap"
      title="ノートはバックグラウンドで継続的に書き直されます"
    >
      ✎ {label}
    </span>
  )
}

function SectionBlock({ section, onJump }: { section: OutlineSection; onJump?: (ts: number) => void }) {
  // Phase 6 added optional fields (takeaway / related_terms / check_question).
  // We render them as plain UI elements — never as their markdown export
  // form. The export pipeline handles the markdown rendering separately.
  const sectionAny = section as OutlineSection & {
    takeaway?: string
    related_terms?: string[]
    check_question?: string
  }
  return (
    <section className="space-y-2 border-l-2 border-blue-200 pl-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900 leading-snug">
          {section.heading}
        </h3>
        <TsButton ts={section.ts} onJump={onJump} />
      </div>

      {sectionAny.takeaway && (
        <div className="bg-blue-50/60 border-l-2 border-blue-300 pl-2 pr-2 py-1 rounded-r">
          <p className="text-xs text-gray-800 leading-snug">
            <span className="text-[10px] uppercase tracking-wider text-blue-500 font-medium mr-1">要旨</span>
            {sectionAny.takeaway}
          </p>
        </div>
      )}

      {section.summary && !sectionAny.takeaway && (
        <p className="text-xs text-gray-600 leading-relaxed italic">
          {section.summary}
        </p>
      )}

      {section.key_terms.length > 0 && (
        <ul className="space-y-1.5">
          {section.key_terms.map((kt, i) => (
            <li
              key={`${kt.term}-${i}`}
              className="bg-amber-50 border border-amber-100 rounded px-2 py-1.5 text-xs"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold text-amber-900">{kt.term}</span>
                <TsButton ts={kt.ts} onJump={onJump} />
              </div>
              <div className="text-gray-700 mt-0.5 leading-relaxed">
                {kt.definition}
              </div>
            </li>
          ))}
        </ul>
      )}

      {section.points.length > 0 && (
        <ul className="space-y-1">
          {section.points.map((p, i) => (
            <li key={`${p.text.slice(0, 24)}-${i}`} className="text-xs leading-relaxed flex gap-2">
              <span className={p.important ? 'text-amber-600 shrink-0' : 'text-gray-400 shrink-0'}>
                {p.important ? '★' : '•'}
              </span>
              <span className={p.important ? 'text-gray-900 font-medium' : 'text-gray-700'}>
                {p.text}
              </span>
              <TsButton ts={p.ts} onJump={onJump} />
            </li>
          ))}
        </ul>
      )}

      {section.examples.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">
            例
          </div>
          <ul className="space-y-1">
            {section.examples.map((ex, i) => (
              <li key={`${ex.text.slice(0, 24)}-${i}`} className="text-xs text-gray-600 leading-relaxed flex gap-2">
                <span className="text-gray-300 shrink-0">→</span>
                <span>{ex.text}</span>
                <TsButton ts={ex.ts} onJump={onJump} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {sectionAny.related_terms && sectionAny.related_terms.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1">
          {sectionAny.related_terms.map((t, i) => (
            <span
              key={`${t}-${i}`}
              className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded font-medium"
              title="関連用語"
            >
              {t}
            </span>
          ))}
        </div>
      )}

      {sectionAny.check_question && (
        <div className="bg-purple-50/60 border-l-2 border-purple-300 pl-2 pr-2 py-1 rounded-r">
          <p className="text-xs text-gray-800 leading-snug">
            <span className="text-[10px] uppercase tracking-wider text-purple-500 font-medium mr-1">確認</span>
            {sectionAny.check_question}
          </p>
        </div>
      )}
    </section>
  )
}

function TsButton({ ts, onJump }: { ts: number; onJump?: (ts: number) => void }) {
  if (!onJump) {
    return <span className="text-[10px] text-gray-400 font-mono shrink-0">{fmtTs(ts)}</span>
  }
  return (
    <button
      onClick={() => onJump(ts)}
      className="text-[10px] text-gray-400 hover:text-blue-600 font-mono shrink-0 transition-colors"
      title="この時点に戻る"
    >
      {fmtTs(ts)}
    </button>
  )
}
