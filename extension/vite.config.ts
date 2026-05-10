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
    // Source maps included for Chrome Web Store review. Without them,
    // reviewers see only minified bundles and can reject for "code that
    // cannot be inspected" — see Chrome Developer Program Policies §
    // "Single Purpose" and "Functionality" enforcement notes.
    sourcemap: true,
    rollupOptions: {
      input: { sidePanel: 'src/side-panel/index.html' },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
