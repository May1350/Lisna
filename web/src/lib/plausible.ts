// web/src/lib/plausible.ts
/**
 * Plausible analytics integration — two mechanisms:
 *
 * 1. CSS class tagging (passive clicks): add
 *    className="plausible-event-name=EVENT_NAME" to a clickable element.
 *    The tagged-events plausible.io script fires the event automatically.
 *    Use Events.* values as the EVENT_NAME literal so the call site and
 *    this file stay aligned.
 *
 * 2. track() (programmatic): call track(Events.Xxx) for events not driven by
 *    a direct DOM click (e.g. form submission, async-completion, route change).
 *    Do NOT combine with className tagging on the same element — that would
 *    double-fire the event in Plausible.
 */
declare global {
  interface Window {
    plausible?: (event: string, options?: { props?: Record<string, string> }) => void
  }
}

export function track(event: string, props?: Record<string, string>): void {
  if (typeof window !== 'undefined' && typeof window.plausible === 'function') {
    window.plausible(event, props ? { props } : undefined)
  }
}

export const Events = {
  DownloadClick: 'download_click',
  SigninInitiated: 'signin_initiated',
  SigninCompleted: 'signin_completed',
  DiscordClick: 'discord_click',
} as const
