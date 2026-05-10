import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { installChromeMock, setStorage } from './chrome-mock'

// Install the chrome.* shim BEFORE any side-panel code is imported, since
// many modules touch chrome.storage.local at module init (i18n bootstrap,
// the captions-collapse hook, etc.).
installChromeMock({
  // Common defaults that the side-panel reads at startup. Overrides per
  // fixture are done by the fixture itself before render.
  'sh.captionsCollapsed': false,
  'sh.railCollapsed': false,
  'sh.enabled': true,
  'sh.playback': 'auto',
  'sh.disableDurationHours': 24,
  'sh.autoDownload': false,
})

// Allow fixtures to seed extra storage by exposing this on window.
// Fixtures that depend on storage state use it inside render().
;(globalThis as Record<string, unknown>).__galleryStorage = setStorage

// Bootstrap i18n so that t().xxx returns real Japanese strings instead
// of throwing. We import dynamically to avoid loading side-panel code
// until the chrome mock is in place.
async function boot(): Promise<void> {
  const { bootstrap } = await import('../shared/i18n')
  await bootstrap().catch(() => undefined)
  const { Gallery } = await import('./Gallery')
  await import('../side-panel/index.css') // Tailwind layer + design tokens
  await import('./gallery.css')

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Gallery />
    </StrictMode>
  )
}

void boot()
