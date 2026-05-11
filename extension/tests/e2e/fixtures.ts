import { test as base, chromium, type BrowserContext } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Resolve the built extension's dist directory (where manifest.json lives).
// Tests assume `pnpm build` has already produced this — the dev build with
// `key` field intact, which pins the extension ID to the value below.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const EXTENSION_PATH = path.resolve(__dirname, '../../dist')

// Pinned via manifest.config.ts `key` field (CWS_BUILD=0). Lets every
// test navigate to a stable chrome-extension://<id>/... URL without
// having to discover the runtime ID through the SW.
export const EXTENSION_ID = 'idbgminbpkbiippdncoooeelijagfggp'

// Persistent context fixture — Playwright's launchPersistentContext is
// the only way to load an unpacked Chrome extension. Each test gets its
// own context so chrome.storage.local doesn't leak across tests.
//
// Headless caveat: Chrome's old headless mode (`headless: true` w/o the
// `--headless=new` arg) silently drops extensions. We MUST use the new
// headless mode for extensions to load. The combo below works both
// locally and on Linux CI without xvfb.
export const test = base.extend<{ context: BrowserContext }>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      // headless:false + --headless=new arg = new headless mode that
      // loads extensions. (headless:true alone would use the old mode
      // and the extension wouldn't register.)
      headless: false,
      args: [
        '--headless=new',
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-sandbox',
      ],
    })

    // Wait for the extension's service worker to register before any
    // test navigates to chrome-extension://. Without this the goto
    // races the SW startup and fails with ERR_ABORTED.
    let sw = context.serviceWorkers()[0]
    if (!sw) sw = await context.waitForEvent('serviceworker')

    await use(context)
    await context.close()
  },
})

export { expect } from '@playwright/test'
