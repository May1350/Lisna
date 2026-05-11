// Vitest global setup. Runs once before any test file's imports are
// evaluated — the seam we need because LoginScreen.tsx reads
// chrome.runtime.getURL at module-load time (LOGO_URL const), so
// chrome must already exist on globalThis by the time vitest's
// import-resolver pulls in the component.
import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// RTL v16 under vitest's globals mode does not auto-cleanup between
// tests. Without this, a render() in test N leaves DOM mounted and
// test N+1's queries can match those orphaned nodes.
afterEach(() => {
  cleanup()
})

// Minimal chrome.* surface — only the keys our code paths actually
// read at module-load or render time. storage stubs are no-ops so
// src/shared/i18n/index.ts's top-level
// chrome.storage.onChanged.addListener call doesn't blow up during
// component import. Methods we want to assert against (sendMessage)
// are vi.fn; passive reads (getURL) are plain stubs.
const chromeMock = {
  runtime: {
    getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
    sendMessage: vi.fn(() => Promise.resolve({ ok: true })),
    // The SP_BROADCAST transport listener inside useSession (and any
    // future hook that subscribes to SW broadcasts) calls this at
    // hook mount. The default no-op + matching removeListener keeps
    // the listener subscription path lifecycle-clean across tests.
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
  storage: {
    local: {
      get: vi.fn(() => Promise.resolve({})),
      set: vi.fn(() => Promise.resolve()),
      remove: vi.fn(() => Promise.resolve()),
    },
    onChanged: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
}

// Cast through unknown because @types/chrome's full surface is huge
// and we deliberately stub only the keys our code paths touch.
;(globalThis as unknown as { chrome: typeof chromeMock }).chrome = chromeMock
