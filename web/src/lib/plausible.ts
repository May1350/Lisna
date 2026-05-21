// web/src/lib/plausible.ts
declare global {
  interface Window {
    plausible?: (event: string, options?: { props?: Record<string, string> }) => void
  }
}

export function track(event: string, props?: Record<string, string>): void {
  if (typeof window !== 'undefined' && window.plausible) {
    window.plausible(event, props ? { props } : undefined)
  }
}

export const Events = {
  DownloadClick: 'download_click',
  SigninInitiated: 'signin_initiated',
  SigninCompleted: 'signin_completed',
  DiscordClick: 'discord_click',
} as const
