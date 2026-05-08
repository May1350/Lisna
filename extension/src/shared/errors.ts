import { API_BASE_URL } from './config'
import { getUser } from './storage'

type Severity = 'fatal' | 'error' | 'warning'

interface ReportOptions {
  context?: string
  severity?: Severity
  metadata?: Record<string, unknown>
  silent?: boolean
}

// Toast subscription channel — kept here so the reporting plumbing stays
// decoupled from the UI. Any frame can mount a listener; if nothing is
// listening (service worker context, options page during init, etc.), we
// still ship the report to the backend without surfacing a toast.
type ToastListener = (err: { message: string; severity: Severity }) => void
const listeners = new Set<ToastListener>()

export function subscribeToErrorToasts(fn: ToastListener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function notifyToastListeners(message: string, severity: Severity) {
  for (const fn of listeners) {
    try { fn({ message, severity }) } catch { /* never let a listener break reporting */ }
  }
}

/**
 * Report an error to the backend and (unless silent) surface a toast.
 * Best-effort — failures to deliver are swallowed.
 */
export async function reportError(
  err: unknown,
  options: ReportOptions = {},
): Promise<void> {
  const { context, severity = 'error', metadata, silent = false } = options
  const error = err instanceof Error ? err : new Error(String(err))
  const message = error.message || 'Unknown error'

  // eslint-disable-next-line no-console
  console.error(`[Lisna:${context ?? 'unknown'}]`, error)

  if (!silent) notifyToastListeners(message, severity)

  if (typeof chrome === 'undefined' || !chrome.runtime?.id) return

  try {
    const user = await getUser().catch(() => null)
    const version = chrome.runtime.getManifest?.().version
    await fetch(`${API_BASE_URL}/v1/errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        stack: error.stack,
        context,
        severity,
        metadata,
        userId: user?.id,
        extensionVersion: version,
        userAgent: navigator.userAgent,
        url: typeof location !== 'undefined' ? location.href : undefined,
      }),
      signal: AbortSignal.timeout(5000),
    })
  } catch {
    // Network failure during error reporting is itself uninteresting.
  }
}

/**
 * Wrap an async function so any thrown error is reported and (by default)
 * swallowed. Returns the original return value, or undefined on error.
 */
export async function withErrorReporting<T>(
  fn: () => Promise<T>,
  options: ReportOptions & { rethrow?: boolean } = {},
): Promise<T | undefined> {
  try {
    return await fn()
  } catch (e) {
    await reportError(e, options)
    if (options.rethrow) throw e
    return undefined
  }
}

/**
 * Install global handlers for unhandled rejections and uncaught errors.
 * Call once per execution context.
 */
export function installGlobalErrorHandlers(context: string): void {
  if (typeof window === 'undefined') return

  window.addEventListener('error', (event) => {
    void reportError(event.error ?? new Error(event.message), {
      context: `${context}:window.error`,
      severity: 'error',
      silent: true,
    })
  })

  window.addEventListener('unhandledrejection', (event) => {
    void reportError(event.reason, {
      context: `${context}:unhandledrejection`,
      severity: 'error',
      silent: true,
    })
  })
}
