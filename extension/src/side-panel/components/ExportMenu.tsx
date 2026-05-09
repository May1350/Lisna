import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  exportZip, exportHtml, pushToObsidian,
  type ExportInput,
} from '../lib/export'
import { getObsidianConfig } from '../../shared/storage'
import { ObsidianMark } from './ObsidianMark'
import { DownloadIcon, GlobeIcon } from './icons'
import { useT, interpolate } from '../../shared/i18n'

// ExportMenu — two-option export surface.
//
//   - ⬇ .zip   → Markdown + slide images as separate files. Layout
//                matches Obsidian's folder-per-lecture convention so
//                unzipping into a vault root makes the wikilinks +
//                slide refs resolve automatically. Recommended for
//                vault users (Obsidian / Logseq / Foam).
//
//   - 🌐 .html → Single self-contained HTML file. Slide images
//                inlined as base64 data URIs; opens in any browser
//                on any OS. User can `Cmd+P → Save as PDF` to get
//                a print-friendly export. Recommended for everyone
//                who doesn't manage a markdown vault.
//
// (The previous "single .md with embedded base64" option was
// removed — its only user base overlapped with .zip.)

interface Props extends ExportInput {}

type ExportFormat = 'zip' | 'html' | 'obsidian'

export function ExportMenu(props: Props) {
  const T = useT()
  // Default selection: .zip if there are slides AND user is likely
  // a vault user (we can't really tell, but slides + the user
  // intentionally clicking ▾ implies engaged use). Otherwise .html
  // is the safe non-vault default.
  const [format, setFormat] = useState<ExportFormat>(props.slides.length > 0 ? 'zip' : 'html')
  const [busy, setBusy] = useState(false)
  const [transient, setTransient] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [obsidianReady, setObsidianReady] = useState(false)
  // Obsidian option only surfaces when the user has set up their
  // REST API credentials in Options. Avoids cluttering the menu for
  // the 95% of users who haven't enabled the integration.
  useEffect(() => {
    void getObsidianConfig().then(c => setObsidianReady(!!c.apiUrl && !!c.apiKey))
  }, [])

  // Stable id for the most-recent flash() timer. Rapid successive
  // exports must NOT stack timers — each new flash supersedes the
  // previous one (otherwise an older `setTransient(null)` could fire
  // 1.6 s after a newer flash, blanking the just-displayed message).
  // Cleared on unmount as well so a flash that's still pending when
  // the menu closes can't run setTransient on an unmounted component.
  const flashTimerRef = useRef<number | null>(null)
  const flash = (msg: string, ms = 1600) => {
    if (flashTimerRef.current !== null) {
      window.clearTimeout(flashTimerRef.current)
    }
    setTransient(msg)
    flashTimerRef.current = window.setTimeout(() => {
      flashTimerRef.current = null
      setTransient(null)
    }, ms)
  }
  useEffect(() => {
    return () => {
      if (flashTimerRef.current !== null) {
        window.clearTimeout(flashTimerRef.current)
        flashTimerRef.current = null
      }
    }
  }, [])

  // Outside-click + Escape dismissal for the format-picker popover.
  // The popover is anchored next to the ▾ button; a document-level
  // mousedown handler closes it when the user clicks anywhere outside
  // the popover or its trigger. Listeners are only attached while
  // open=true so we're not paying for them on every render.
  // The triggerRef exclusion prevents a click on ▾ from racing the
  // toggle: without it, mousedown would close via outside-click and
  // the subsequent click would toggle back open.
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node | null
      if (!target) return
      if (popoverRef.current?.contains(target)) return
      if (triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const onClickPrimary = async () => {
    if (busy) return
    setBusy(true)
    try {
      if (format === 'html') {
        await exportHtml(props)
        flash(T.export.success_html)
      } else if (format === 'obsidian') {
        const r = await pushToObsidian(props)
        if (r.ok) flash(interpolate(T.export.success_obsidian, { n: r.files }))
        else flash(interpolate(T.export.failObsidian, { error: r.error ?? T.export.obsidianFallback }), 2800)
      } else {
        await exportZip(props)
        flash(interpolate(T.export.success_zip, { n: props.slides.length }))
      }
    } catch (e) {
      flash(T.export.failPrefix + (e instanceof Error ? e.message : 'unknown'), 2400)
    } finally {
      setBusy(false)
    }
  }

  // Disable .zip when there are no slides — a zip with just the .md
  // and no images is silly. Plain .html remains the right answer.
  const zipDisabled = props.slides.length === 0
  // Each label carries its own icon node — outline SVGs that follow
  // currentColor (so they read as part of the surrounding text)
  // instead of emoji glyphs whose OS-rendered colors clashed with
  // the indigo / violet / yellow brand palette.
  const labels: Record<ExportFormat, { icon: ReactNode; primary: string; menu: string; subtitle: string }> = {
    zip: {
      icon: <DownloadIcon size={14} />,
      primary: T.export.zip.primary,
      menu: T.export.zip.menu,
      subtitle: zipDisabled
        ? T.export.zip.subtitle_noSlides
        : interpolate(T.export.zip.subtitle_withSlides, { n: props.slides.length }),
    },
    html: {
      icon: <GlobeIcon size={14} />,
      primary: T.export.html.primary,
      menu: T.export.html.menu,
      subtitle: props.slides.length > 0
        ? interpolate(T.export.html.subtitle_withSlides, { n: props.slides.length })
        : T.export.html.subtitle_noSlides,
    },
    obsidian: {
      icon: <ObsidianMark />,
      primary: T.export.obsidian.primary,
      menu: T.export.obsidian.menu,
      subtitle: T.export.obsidian.subtitle,
    },
  }

  return (
    <div className="relative flex gap-1">
      <button
        onClick={onClickPrimary}
        disabled={busy || (format === 'zip' && zipDisabled)}
        className="flex-1 bg-ink-900 hover:bg-ink-700 disabled:bg-ink-200 disabled:text-ink-500 text-paper-100 text-xs font-medium py-2 px-3 rounded-l-[10px] transition-colors flex items-center justify-center gap-1.5"
      >
        {busy ? (
          T.export.busy
        ) : transient ? (
          transient
        ) : (
          <>
            {labels[format].icon}
            <span>{labels[format].primary}</span>
          </>
        )}
      </button>

      <button
        ref={triggerRef}
        onClick={() => setOpen(o => !o)}
        disabled={busy}
        className="bg-ink-900 hover:bg-ink-700 disabled:bg-ink-200 disabled:text-ink-500 text-paper-100 text-xs font-medium py-2 px-2 rounded-r-[10px] border-l border-paper-100/15 transition-colors"
        aria-label={T.export.formatPickerAria}
      >
        ▾
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="absolute bottom-full mb-2 right-0 bg-paper-100 border border-paper-edge rounded-[10px] shadow-card overflow-hidden min-w-[280px] z-10"
          onClick={(e) => e.stopPropagation()}
        >
          {((['zip', 'html', ...(obsidianReady ? ['obsidian'] : [])] as ExportFormat[])).map(f => {
            const disabled = f === 'zip' && zipDisabled
            return (
              <button
                key={f}
                disabled={disabled}
                onClick={() => { if (disabled) return; setFormat(f); setOpen(false) }}
                className={`w-full px-3 py-2 text-left text-xs hover:bg-paper-200 flex items-start gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-paper-100 ${
                  format === f ? 'bg-paper-200' : ''
                }`}
              >
                <span className="mt-0.5 shrink-0">{labels[f].icon}</span>
                <span className="flex flex-col gap-0.5 min-w-0">
                  <span className="font-medium text-ink-900">{labels[f].menu}</span>
                  <span className="text-[10px] text-ink-500">{labels[f].subtitle}</span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
