import type { GalleryFixture } from './types'
import { createElement as h, useEffect, type ReactNode } from 'react'
import { ErrorToast } from '../../side-panel/components/ErrorToast'
import { ErrorBoundary } from '../../side-panel/components/ErrorBoundary'
import { reportError } from '../../shared/errors'
import { useT } from '../../shared/i18n'
import type { Translations } from '../../shared/i18n'

const CATEGORY = 'Errors'

// ── ErrorToast fixtures ────────────────────────────────────────────────
//
// ErrorToast subscribes to the global `subscribeToErrorToasts` channel.
// `reportError(...)` is the public publisher that fans out to every
// subscriber. It also fires a best-effort backend POST, but that fetch
// is wrapped in try/catch inside reportError itself — gallery renders
// stay safe even when the chrome-mock makes the network call fail.
//
// We use a tiny wrapper component that publishes once on mount, then
// renders the real ErrorToast so the toast UI itself is the gallery
// subject.

interface ToastDemoProps {
  severity: 'fatal' | 'error' | 'warning'
  message: string
}

function ToastDemo({ severity, message }: ToastDemoProps): ReactNode {
  useEffect(() => {
    void reportError(new Error(message), { severity, context: 'gallery:toast-demo' })
  }, [severity, message])
  return h(ErrorToast)
}

// Static recreation of the App.tsx curateError banner. Keep in sync
// with src/side-panel/App.tsx (humanizeCurateError + the inline banner
// JSX around the ERROR_REPORTABLE check).
const ERROR_REPORTABLE = new Set<string>(['curator_failed', 'timeout_no_signal', 'request_failed'])

function CurateErrorBanner({ reason }: { reason: keyof Translations['curateError'] }) {
  const T = useT()
  const known = T.curateError as Record<string, string>
  const text = known[reason as string] ?? T.curateError.fallback
  const reportable = ERROR_REPORTABLE.has(reason as string)
  return h(
    'div',
    {
      className:
        'mx-3 mb-1 bg-warn-red/5 border border-warn-red/30 text-warn-red text-xs px-3 py-2 rounded flex items-start gap-2',
    },
    h('span', { className: 'flex-1' }, text),
    reportable
      ? h(
          'button',
          {
            type: 'button',
            className:
              'shrink-0 text-[11px] font-medium text-warn-red hover:text-warn-red underline whitespace-nowrap',
          },
          T.curateError.reportButton,
        )
      : null,
  )
}

// Boom: throws on every render. Triggers ErrorBoundary's fallback UI.
function Boom(): never {
  throw new Error('Demo: simulated render failure (Boom component)')
}

export const errorFixtures: GalleryFixture[] = [
  // ── ErrorToast — three severities ────────────────────────────────
  {
    id: 'error-toast-warning',
    category: CATEGORY,
    label: 'ErrorToast — warning (auto-dismiss 4 s)',
    note: 'Real ErrorToast subscribed to reportError publisher.',
    height: 200,
    render: () =>
      h(ToastDemo, {
        severity: 'warning',
        message: 'rate-limit reached on backend',
      }),
  },
  {
    id: 'error-toast-error',
    category: CATEGORY,
    label: 'ErrorToast — error (auto-dismiss 8 s)',
    note: 'Real ErrorToast subscribed to reportError publisher.',
    height: 200,
    render: () =>
      h(ToastDemo, {
        severity: 'error',
        message: 'HTTP 500 — upstream curator failed',
      }),
  },
  {
    id: 'error-toast-fatal',
    category: CATEGORY,
    label: 'ErrorToast — fatal (no auto-dismiss)',
    note: 'Real ErrorToast subscribed to reportError publisher.',
    height: 200,
    render: () =>
      h(ToastDemo, {
        severity: 'fatal',
        message: 'unrecoverable: storage quota exceeded',
      }),
  },

  // ── ErrorBoundary — triggered fallback ───────────────────────────
  {
    id: 'error-boundary-fallback',
    category: CATEGORY,
    label: 'ErrorBoundary — render-failure fallback',
    note: 'Wraps a child that throws on first render; "no error" state is omitted.',
    height: 520,
    render: () => h(ErrorBoundary, null, h(Boom)),
  },

  // ── Curate-failed banner (static recreation; inline in App.tsx) ──
  {
    id: 'curate-error-curator-failed',
    category: CATEGORY,
    label: 'curateError banner — curator_failed',
    note: 'Static recreation of inline App.tsx banner. Includes Report CTA.',
    render: () => h(CurateErrorBanner, { reason: 'curator_failed' }),
  },
  {
    id: 'curate-error-timeout-no-signal',
    category: CATEGORY,
    label: 'curateError banner — timeout_no_signal',
    note: 'Static recreation of inline App.tsx banner. Includes Report CTA.',
    render: () => h(CurateErrorBanner, { reason: 'timeout_no_signal' }),
  },
  {
    id: 'curate-error-request-failed',
    category: CATEGORY,
    label: 'curateError banner — request_failed',
    note: 'Static recreation of inline App.tsx banner. Includes Report CTA.',
    render: () => h(CurateErrorBanner, { reason: 'request_failed' }),
  },
]
