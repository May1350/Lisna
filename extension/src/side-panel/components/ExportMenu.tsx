import { useState } from 'react'
import { callApi } from '../api-client'
import { API_BASE_URL } from '../../shared/config'
import { getToken } from '../../shared/storage'

// ExportMenu — replacement for the old DownloadButton.
//
// Phase 6 pivot: the curator's Outline JSON is the source of truth, and
// we render it in TWO targets:
//   1. The modal UI (OutlineView.tsx) — plain text + Tailwind, ZERO
//      markdown syntax visible to the user.
//   2. Obsidian-flavored markdown — frontmatter, [[wikilinks]], callouts,
//      ^block-ids, deep-time-links — produced server-side by
//      backend/src/lib/markdown-obsidian.ts via /v1/session?format=markdown.
//
// This component exposes both directions of (2):
//   - 📋 Copy as Markdown    → clipboard (Obsidian paste UX)
//   - ⬇ Download .md         → file download (vault drop UX)
//   - ⬇ Download .pdf         → legacy PDF (kept for users who don't use PKM)
//
// Design choices:
//   - Single primary button + a small dropdown trigger. Avoids cluttering
//     the modal with three buttons. The user picks the export they want
//     once and the choice sticks for the session.
//   - Inline transient state — "Copied!" / "Downloading…" feedback right
//     on the button so we don't need a toast system.
//   - Markdown fetch goes through the SW because the auth token lives in
//     SW storage and we want one consistent API path.

interface FinalizeResponse {
  pdf_url?: string
}

type ExportFormat = 'markdown' | 'clipboard' | 'pdf'

interface Props {
  sessionId: string
  /** Page URL the session is bound to — needed for ?url= lookup on
   *  /v1/session?format=markdown which keys by user_id + url_hash. */
  sourceUrl: string
  /** Used only as a hint for the PDF generator and the file download
   *  filename if the backend doesn't supply one. */
  title: string
}

export function ExportMenu({ sessionId, sourceUrl, title }: Props) {
  const [format, setFormat] = useState<ExportFormat>('markdown')
  const [busy, setBusy] = useState(false)
  const [transient, setTransient] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  const flash = (msg: string, ms = 1600) => {
    setTransient(msg)
    window.setTimeout(() => setTransient(null), ms)
  }

  const fetchMarkdown = async (): Promise<string> => {
    // /v1/session?url=...&format=markdown returns text/markdown directly.
    // We fetch from the page context (modal iframe) using the stored
    // bearer token; SW round-trip would buffer the whole markdown body
    // into a JSON wrapper which is a waste.
    const token = await getToken()
    const r = await fetch(
      `${API_BASE_URL}/v1/session?url=${encodeURIComponent(sourceUrl)}&format=markdown`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    if (!r.ok) throw new Error(`markdown fetch failed: ${r.status}`)
    return await r.text()
  }

  const onClickPrimary = async () => {
    if (busy) return
    setBusy(true)
    try {
      if (format === 'clipboard') {
        const md = await fetchMarkdown()
        await navigator.clipboard.writeText(md)
        flash('✓ コピーしました')
      } else if (format === 'markdown') {
        const md = await fetchMarkdown()
        // Browser-native download via blob URL. Filename uses the lecture
        // title, sanitised for filesystem-illegal characters.
        const safeTitle = (title || 'lecture').replace(/[\\/:"*?<>|]/g, '_').slice(0, 80)
        const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${safeTitle}.md`
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
        flash('✓ ダウンロードしました')
      } else if (format === 'pdf') {
        // Legacy PDF path via existing finalize endpoint.
        const r = await callApi<FinalizeResponse>('/v1/session/finalize', 'POST', {
          session_id: sessionId,
          title,
          format: 'pdf',
        })
        if (r.pdf_url) window.open(r.pdf_url, '_blank')
        flash('✓ PDF を開きました')
      }
    } catch (e) {
      flash('✕ 失敗: ' + (e instanceof Error ? e.message : 'unknown'), 2400)
    } finally {
      setBusy(false)
    }
  }

  const labels: Record<ExportFormat, { primary: string; menu: string; subtitle: string }> = {
    markdown:  { primary: '⬇ Markdown',     menu: '⬇ Markdown ファイル',     subtitle: '.md ダウンロード (Obsidian / Notion)' },
    clipboard: { primary: '📋 コピー',       menu: '📋 クリップボードにコピー', subtitle: 'Obsidian にそのまま貼り付け' },
    pdf:       { primary: '⬇ PDF',          menu: '⬇ PDF ファイル',          subtitle: '印刷向けレイアウト' },
  }

  return (
    <div className="relative flex gap-1">
      {/* Primary action button — runs the currently selected format */}
      <button
        onClick={onClickPrimary}
        disabled={busy}
        className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 disabled:text-gray-500 text-white text-xs font-medium py-2 px-3 rounded-l-lg transition flex items-center justify-center gap-1"
      >
        {busy ? '処理中…' : (transient ?? labels[format].primary)}
      </button>

      {/* Format-picker dropdown trigger */}
      <button
        onClick={() => setOpen(o => !o)}
        disabled={busy}
        className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 disabled:text-gray-500 text-white text-xs font-medium py-2 px-2 rounded-r-lg border-l border-emerald-500/40 transition"
        aria-label="エクスポート形式を選択"
      >
        ▾
      </button>

      {open && (
        <div
          className="absolute bottom-full mb-2 right-0 bg-white border border-gray-200 rounded-lg shadow-xl overflow-hidden min-w-[220px] z-10"
          // Click anywhere = stop propagation so the menu doesn't close
          // when the user is reading subtitle text. Closes on selection.
          onClick={(e) => e.stopPropagation()}
        >
          {(['markdown', 'clipboard', 'pdf'] as ExportFormat[]).map(f => (
            <button
              key={f}
              onClick={() => { setFormat(f); setOpen(false) }}
              className={`w-full px-3 py-2 text-left text-xs hover:bg-gray-50 flex flex-col gap-0.5 transition ${
                format === f ? 'bg-emerald-50' : ''
              }`}
            >
              <span className="font-medium text-gray-900">{labels[f].menu}</span>
              <span className="text-[10px] text-gray-500">{labels[f].subtitle}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
