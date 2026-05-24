---
description: Run a Playwright + Chromium screenshot loop against the local dev server, inspect each shot via the Read tool, and surface CSS / layout bugs
argument-hint: "[url] [viewports]"
---

# /visual-verify

You just made a non-trivial design / layout change. Type-check and tests
don't catch shadow bleed, stacking-context glitches, overflow, off-by-1
margin alignment, or "this just looks wrong". Run this loop instead.

## When to use

- Touched `globals.css`, `tailwind.config.ts`, a marketing component, or
  any utility used by the landing surface
- A new component went into `web/src/components/marketing/`
- A `Postit` / `Hero` / `FeatureBlock` / `Marginalia` / `NavBar` change
- A reviewer flagged "the X looks off"

DON'T use for: pure logic changes (auth, API routes, db). Use tests.

## Steps

1. **Bring up dev server** (if not already running):
   ```sh
   cd web
   pnpm dev > /tmp/web-dev.log 2>&1 &
   sleep 6 && curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3000/ko
   ```
   Expect HTTP 200. If 500, check `/tmp/web-dev.log` — usually missing
   env vars; create `web/.env.local` with placeholders for
   `NEXTAUTH_URL`, `NEXTAUTH_SECRET` (≥32 chars), `DATABASE_URL`.

2. **Confirm Chromium is available**:
   ```sh
   ls /opt/pw-browsers/chromium-*/chrome-linux/chrome
   ```
   Playwright's bundled CDN is blocked by the container's network
   policy; the pre-baked binary at `/opt/pw-browsers/chromium-1194/...`
   is what we use. If missing, `apt-get install -y chromium-browser`
   fails on Ubuntu (snap requirement); fall back to the bundled binary
   path discovered by `find / -name chrome -executable -type f`.

3. **Write a capture script** that walks viewports + sections. Template:
   ```js
   const { chromium } = require('/home/user/Lisna/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright');
   const fs = require('fs');
   const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
   const URL = process.argv[2] || 'http://localhost:3000/ko';
   const OUT = process.argv[3] || '/tmp/shots';
   fs.mkdirSync(OUT, { recursive: true });
   (async () => {
     const browser = await chromium.launch({ executablePath: CHROME, headless: true });
     for (const vp of [
       { name: 'desktop', w: 1440, h: 900 },
       { name: 'tablet',  w: 1024, h: 1366 },
       { name: 'mobile',  w: 390,  h: 844 },
     ]) {
       const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1.5 });
       const page = await ctx.newPage();
       await page.goto(URL, { waitUntil: 'networkidle' });
       await page.waitForTimeout(700);
       // Chunked vertical captures so each PNG fits in the Read window
       const total = await page.evaluate(() => document.documentElement.scrollHeight);
       const chunks = Math.ceil(total / 1100);
       for (let i = 0; i < chunks; i++) {
         await page.evaluate(y => window.scrollTo(0, y), i * 1100);
         await page.waitForTimeout(300);
         await page.screenshot({ path: `${OUT}/${vp.name}-p${i+1}.png`, fullPage: false });
       }
       await ctx.close();
     }
     await browser.close();
     console.log('done');
   })().catch(e => { console.error(e); process.exit(1); });
   ```
   Run: `node script.js http://localhost:3000/ko /tmp/shots`

4. **Inspect each shot with the Read tool**. The Read tool reads PNGs as
   images (multimodal). For each chunk, look for:
   - **Shadow bleed**: cast shadow above element edge → `filter:
     drop-shadow` has `blur > y`. Fix: `y ≥ blur`.
   - **Stacking glitches**: page-margin lines / decorative pseudos
     showing on top of opaque section backgrounds when they shouldn't,
     or vice versa. Fix: prefer `background-image` over `::before` for
     full-page decorations.
   - **Overflow**: cards / images extending past the page container,
     dark backdrop showing through. Fix: missing responsive padding,
     missing `max-width`, or `object-fit`.
   - **Tiny / oversized shadows at different viewports**: shadow values
     in `px` instead of `em`. Fix: em-scale + `font-size: clamp()`.
   - **Margin / alignment off-by-1**: utility class missing a responsive
     prefix or `var(--margin-offset)` not set per viewport.
   - **Color hierarchy collapse**: two related elements painted in the
     same red (or same gray) so the eye can't separate them. Fix:
     reach for the existing token family — don't add a new shade.

5. **Element-level zoom captures** for ambiguous areas. Add to script:
   ```js
   const el = await page.$('.target-class');
   if (el) {
     await el.scrollIntoViewIfNeeded();
     const box = await el.boundingBox();
     await page.screenshot({ path: `${OUT}/zoom-target.png`, clip: { x: Math.max(0, box.x - 40), y: Math.max(0, box.y - 40), width: box.width + 80, height: box.height + 80 } });
   }
   ```
   `deviceScaleFactor: 2` gives sharper crops for fine details (1.5px
   margin lines, shadow gradients).

6. **Repeat after each fix.** The loop is fast (<10s per round). Don't
   batch — each fix may unmask the next bug.

7. **Stop conditions**: every viewport's full-page capture looks
   intentional, every element zoom matches the spec in
   `web/src/styles/globals.css`, and you've validated at least one
   reverse-direction case (e.g. `feature--reverse`).

## Caveats specific to this container

- **No external image hosts**: `unsplash`, `pixabay`, `wikimedia/upload`
  all return 403 (`host_not_allowed`). If you need real-image textures,
  ask the user to upload; don't try to fetch.
- **MCP github tools may disconnect** after container inactivity. They
  auto-reconnect on next session; don't try to re-auth unless tools are
  still missing after the session start hook fires.
- **`dev server` background output**: Next.js prints "Ready in 700ms"
  then keeps the process alive; your `Bash` background-task notification
  fires only when the sleep+curl wrapper exits, NOT when next dies.
  Always `curl` to verify the server actually responded.

## Output format

End with a short summary:

```
Verified at: desktop 1440 / tablet 1024 / mobile 390
Bugs found (n): <one-line each, file + cause + fix>
Stop reason: clean, or <known issue out of scope>
Screenshots at: <path>
```

Argument: $ARGUMENTS
