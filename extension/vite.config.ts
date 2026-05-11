import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.config'

// Dev gallery is a standalone HTML page (src/dev-gallery/index.html) used
// for visual review of every UI surface. It is served by `vite` in dev
// but excluded from the production extension build — Chrome doesn't load
// it, and we don't want it in the CWS bundle.
export default defineConfig({
  plugins: [
    react(),
    // The crx plugin reads manifest.config.ts to wire the extension build.
    // It does NOT interfere with extra HTML entries served via `vite dev`.
    crx({ manifest }),
  ],
  // `vite dev` serves any HTML in src/ if you visit its path; no extra
  // config needed for the gallery during dev. The entry below only
  // affects `vite build`, which we don't want including the gallery.
  build: {
    // Sourcemaps in dev builds (so CWS reviewers can inspect minified
    // bundles when running `pnpm build` without the CWS flag, and so
    // local debugging works), but DROPPED for CWS_BUILD=1 to keep the
    // shipped manifest's web_accessible_resources from referencing
    // .map files that the ZIP step strips. Without this gate, the
    // runtime browser logs sourceMappingURL 404s every time a content
    // script loads on a host page.
    sourcemap: process.env.CWS_BUILD !== '1',
    rollupOptions: {
      input: { sidePanel: 'src/side-panel/index.html' },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    // Loaded BEFORE any test file's imports are evaluated — the seam
    // we need because LoginScreen.tsx reads `chrome.runtime.getURL`
    // at module-load time, so the chrome global must already exist
    // by the time vitest's resolver pulls the component in.
    setupFiles: ['./tests/setup.ts'],
    // Vitest picks `**/*.{test,spec}.ts` by default — exclude the
    // Playwright E2E specs (which look identical by extension) so
    // they only run via `pnpm test:e2e`.
    exclude: ['node_modules', 'dist', 'tests/e2e/**'],
  },
})
