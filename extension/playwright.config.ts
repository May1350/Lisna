import { defineConfig } from '@playwright/test'

// Chrome extensions are stateful (one persistent context per test
// run loads the manifest + service worker + content scripts), so
// parallel tests would race against shared chrome.storage.local
// and a single shared SW. Keep workers at 1 — fast enough for the
// scenarios we cover, no flake risk.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    actionTimeout: 5_000,
    navigationTimeout: 10_000,
    // Capture trace on first retry so CI failures are debuggable
    // without re-running locally.
    trace: 'on-first-retry',
  },
  retries: process.env.CI ? 1 : 0,
})
