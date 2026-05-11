import { test, expect } from './fixtures'

// Regression test for Phase 5b — inline-button CSS externalization.
// The 245-line CSS template literal previously embedded inside
// inline-button.ts's `ensureStyle()` was extracted to a sibling
// inline-button.css file imported via Vite's `?raw` suffix. The risk
// is bundling silently dropping the CSS payload, or the runtime
// injection path swapping content (e.g. import default URL instead
// of file body, leaving `style.textContent = '/assets/abc.css'`).
//
// Coverage:
//   1. Content script mounts the inline button on a host page with
//      a <video> element.
//   2. The injected <style> tag exists in the DOM after mount.
//   3. Core static visual tokens are preserved by getComputedStyle.
//      These are the values the externalized file MUST keep —
//      breaking any of them is a visible regression in production.
//   4. Clicking the button triggers the production modal-mount path.
//
// What we deliberately don't assert (too brittle / env-dependent):
//   - backdrop-filter computed value (headless Chrome inconsistent)
//   - exact RGB of background-color (color profile drift)
//   - animation/keyframe progress (transient, version-coupled)
//   - exact pixel position (depends on video rect / viewport)

// Minimal HTML served via page.route() — a real https:// origin so
// the extension's content_scripts <all_urls> match triggers script
// injection (data: URLs don't match <all_urls>; file:// needs flags
// + per-extension permission). The .invalid TLD reserves a name that
// will never be a real public site, so there's no chance of a real
// network call leaking out under a misconfigured intercept.
const FIXTURE_URL = 'https://lisna-test.invalid/inline-button-fixture'
const FIXTURE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Lisna inline-button fixture</title></head>
<body>
  <h1>fixture</h1>
  <video width="640" height="480" controls
         src="data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDE="></video>
</body></html>`

test.describe('inline-button content script', () => {
  test('mounts on host page with <video>, applies CSS, click opens modal', async ({ context }) => {
    const page = await context.newPage()

    // Intercept the fixture URL with our inline HTML. Real https://
    // origin so the content script's <all_urls> match succeeds.
    await page.route(FIXTURE_URL, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: FIXTURE_HTML,
      })
    })

    await page.goto(FIXTURE_URL)

    // (1) The inline button mounts. The content script's tryMountButton
    // path is gated on findBestVideo passing the width-or-videoWidth
    // check; our 640x480 <video> passes the width>100 leg immediately
    // after layout. Generous timeout (5 s) because document_idle fires
    // after the load event and mountInlineButton has a deferred
    // reposition window.
    const btn = page.locator('#__sh_inline_button_root__')
    await expect(btn).toBeVisible({ timeout: 5_000 })

    // (2) The <style> tag exists, attached to documentElement by
    // ensureStyle(). Direct "did the CSS injection path run" assertion
    // — if the ?raw import returned an empty string or an asset URL,
    // the style tag would still exist but the computed styles below
    // would fail.
    await expect(page.locator('#__sh_inline_button_style__')).toHaveCount(1)

    // (3) Core static visual tokens. These five values must survive
    // any refactor of inline-button.css — breaking any of them is a
    // visible regression to live users.
    const styles = await btn.evaluate((el) => {
      const cs = window.getComputedStyle(el)
      return {
        position: cs.position,
        zIndex: cs.zIndex,
        width: cs.width,
        height: cs.height,
        // shorthand borderRadius can be unreadable; corner is reliable
        borderRadius: cs.borderTopLeftRadius,
        backgroundColor: cs.backgroundColor,
      }
    })

    expect(styles.position).toBe('absolute')
    expect(styles.zIndex).toBe('999999')
    expect(styles.width).toBe('36px')
    expect(styles.height).toBe('36px')
    // CSS `border-radius: 9999px` may resolve to either "9999px" or
    // (when the renderer clamps to half-perimeter for the actual
    // round-pill corner) ~"18px" depending on Chrome version. Both
    // are acceptable — the assertion is "the radius IS the pill
    // recipe (>= 18px)", not the literal authored value.
    const radiusPx = parseFloat(styles.borderRadius)
    expect(radiusPx).toBeGreaterThanOrEqual(18)
    // Background must be set (not transparent / page default). Exact
    // RGB intentionally not asserted — headless color profile drift
    // would flake it. Non-empty + non-transparent catches "the CSS
    // rule disappeared entirely", which is the actual regression we
    // need to detect.
    expect(styles.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
    expect(styles.backgroundColor).not.toBe('transparent')
    expect(styles.backgroundColor).not.toBe('')

    // (4) Click triggers the production behaviour: the in-page modal
    // mounts. Container id confirmed against in-page-modal.ts:20
    // (CONTAINER_ID = '__sh_modal_container__').
    await btn.click()
    await expect(page.locator('#__sh_modal_container__')).toBeVisible({ timeout: 5_000 })
  })
})
