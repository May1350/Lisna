import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.config'

export default defineConfig({
  plugins: [react(), crx({ manifest })],
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
