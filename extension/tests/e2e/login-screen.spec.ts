import { test, expect, EXTENSION_ID } from './fixtures'

// Regression test for the Phase 1C icon-path slip (9ac6389): the
// manifest's icon paths were updated to `icons/icon128.png` but three
// `chrome.runtime.getURL('public/icons/icon128.png')` source-code
// references were missed. The LoginScreen logo `<img>` then resolved
// to a 404 path, breaking the Lisna brand mark at the very first
// surface a new user sees.
//
// Catching this requires loading the actual built extension and
// verifying the image element renders WITH a non-zero naturalWidth
// (the browser's signal that the source byte stream resolved). No
// amount of typecheck/test/vite-build green coverage caught it
// before — only an E2E with a real Chromium can.
test('LoginScreen brand logo loads (no broken-image regression)', async ({ context }) => {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${EXTENSION_ID}/src/side-panel/index.html`)

  // Seed consent + clear any leftover auth so the renderer arrives at
  // the LoginScreen branch (not ConsentModal, not the logged-in view).
  // chrome.storage.local writes from this page are immediately visible
  // to the React app on the next render.
  await page.evaluate(async () => {
    await chrome.storage.local.clear()
    await chrome.storage.local.set({ 'sh.consent.v1': { acceptedAt: Date.now() } })
  })
  await page.reload()

  // The primary Google sign-in button is the LoginScreen's anchor
  // element. We disambiguate from the secondary "use a different
  // Google account" button (which also contains "Google" in every
  // locale) via the aria-label attribute — only the primary sets it
  // (LoginScreen.tsx renders `aria-label={T.login.button}`).
  await expect(page.locator('button[aria-label]:has-text("Google")')).toBeVisible({ timeout: 10_000 })

  // The brand <img>. The alt = T.login.title = 'Lisna' across all 4 locales.
  const logo = page.locator('img[alt="Lisna"]').first()
  await expect(logo).toBeVisible()

  // Browser-side load check: naturalWidth > 0 means the byte stream
  // resolved (404 paths produce naturalWidth = 0). This is the assertion
  // that Phase 1C would have failed on.
  const loaded = await logo.evaluate(
    (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
  )
  expect(loaded).toBe(true)
})
