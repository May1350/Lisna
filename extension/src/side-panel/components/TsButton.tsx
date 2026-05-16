import { useT } from '../../shared/i18n'

export function fmtTs(secs: number): string {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = Math.floor(secs % 60)
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

export function TsButton({ ts, onJump, inferred }: { ts: number; onJump?: (ts: number) => void; inferred?: boolean }) {
  const T = useT()
  // inferred 항목: 회색 dash (타임스탬프 없음).
  // Scope by provenance, NOT by ts===0 — a section legitimately
  // starting at video time 0 (first section of a lecture) is a
  // valid clickable jump target. Using ts===0 as a proxy would
  // suppress that affordance.
  if (inferred) {
    return <span className="text-[10px] text-ink-300 font-mono tabular-nums shrink-0">—</span>
  }
  if (!onJump) {
    return <span className="text-[10px] text-ink-300 font-mono tabular-nums shrink-0">{fmtTs(ts)}</span>
  }
  // ts chip per DESIGN.md §3.4 — paper-200 surface + paper-edge
  // border + ▶ arrow prefix so the click affordance is obvious in
  // the default state (the previous bare-text version was hard to
  // recognise as interactive). Hover inverts to ink-900 fill.
  return (
    <button
      onClick={() => onJump(ts)}
      className="inline-flex items-center gap-1 text-[10px] text-ink-500 hover:text-paper-100 font-mono tabular-nums shrink-0 transition-colors bg-paper-200 hover:bg-ink-900 border border-paper-edge hover:border-ink-900 rounded px-1.5 py-0.5"
      title={T.outline.tsBackTitle}
    >
      <span aria-hidden className="text-[8px]">▶</span>
      {fmtTs(ts)}
    </button>
  )
}
