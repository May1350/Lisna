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
  if (!outline || outline.sections.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto px-3 py-4">
        <p className="text-sm text-gray-500">処理中... 講義を再生してください。</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
      {outline.title && (
        <h2 className="text-base font-bold text-gray-900 leading-snug">
          {outline.title}
        </h2>
      )}
      {outline.sections.map((section, i) => (
        <SectionBlock key={`${section.heading}-${i}`} section={section} onJump={onJump} />
      ))}
    </div>
  )
}

function SectionBlock({ section, onJump }: { section: OutlineSection; onJump?: (ts: number) => void }) {
  return (
    <section className="space-y-2 border-l-2 border-blue-200 pl-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900 leading-snug">
          {section.heading}
        </h3>
        <TsButton ts={section.ts} onJump={onJump} />
      </div>

      {section.summary && (
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
