import { Component, type ReactNode, type ErrorInfo } from 'react'
import { t } from '../../shared/i18n'
import { reportError } from '../../shared/errors'

// React error boundary covering the entire side-panel / modal tree.
// Without this, an uncaught render error in any descendant blanks out
// the whole modal — to the user it looks like the extension just
// crashed silently. With it, we render a recovery card explaining
// what happened and offering a reload.
//
// Errors are also logged to the console with `[SH:error-boundary]`
// prefix so users can copy-paste into a bug report.

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[SH:error-boundary] React render failure:', error, info)
    void reportError(error, {
      context: 'react-error-boundary',
      severity: 'fatal',
      metadata: { componentStack: info.componentStack },
      silent: true, // boundary already shows fallback UI; toast would be redundant
    })
  }

  reset = (): void => {
    this.setState({ error: null })
  }

  reload = (): void => {
    // The modal lives as an iframe inside the page; reloading the
    // window only refreshes the modal frame, not the page.
    window.location.reload()
  }

  render(): ReactNode {
    if (this.state.error) {
      // ErrorBoundary is a class component, so we use t() (non-React)
      // rather than useT(). Language changes won't re-render the
      // boundary view, which is fine — by the time the user sees this
      // page they're going to reload anyway.
      const T = t()
      return (
        <div className="min-h-screen flex items-center justify-center px-6 py-10 bg-gray-50">
          <div className="max-w-sm w-full bg-white border border-red-200 rounded-lg shadow-sm p-5">
            <div className="text-2xl mb-2" aria-hidden="true">⚠️</div>
            <h2 className="text-base font-semibold text-gray-900 mb-1">
              {T.errorBoundary.title}
            </h2>
            <p className="text-xs text-gray-600 leading-relaxed mb-4">
              {T.errorBoundary.body}
            </p>
            <details className="text-[11px] text-gray-500 mb-4">
              <summary className="cursor-pointer">{T.errorBoundary.detailsLabel}</summary>
              <pre className="mt-2 px-2 py-1.5 bg-gray-50 border border-gray-200 rounded overflow-x-auto text-[10px] font-mono whitespace-pre-wrap break-words">
                {this.state.error.message}
                {this.state.error.stack ? '\n\n' + this.state.error.stack.split('\n').slice(0, 6).join('\n') : ''}
              </pre>
            </details>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={this.reload}
                className="flex-1 px-3 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded transition"
              >
                {T.errorBoundary.reload}
              </button>
              <button
                type="button"
                onClick={this.reset}
                className="px-3 py-2 text-xs text-gray-700 border border-gray-300 hover:bg-gray-50 rounded transition"
              >
                {T.errorBoundary.ignore}
              </button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
