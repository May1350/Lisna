// Regression coverage for the LoginScreen `pickerAvailable` gate
// (LoginScreen.tsx:40). The secondary "use a different Google
// account" button must be HIDDEN in dev builds where
// VITE_GOOGLE_OAUTH_CLIENT_ID is empty (clicking it would throw a
// confusing error from launchWebAuthFlow), and SHOWN in prod builds
// where the WEB-type OAuth client id is wired in.
//
// vi.doMock (not vi.mock) is used so each test can install a
// per-case substitution for ../src/shared/config before dynamically
// importing LoginScreen. vi.resetModules() between tests ensures the
// dynamic import re-evaluates the LoginScreen module against the new
// mock. (vi.mock without `do` is transform-hoisted and would apply
// the same value to every test in the file.)
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

describe('LoginScreen pickerAvailable gate', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('hides the picker button when WEB_OAUTH_CLIENT_ID is empty (dev/test default)', async () => {
    vi.doMock('../src/shared/config', () => ({
      API_BASE_URL: 'http://localhost:3000',
      WS_URL: 'ws://localhost:3001',
      CURATE_URL: '',
      WEB_OAUTH_CLIENT_ID: '',
    }))
    const { LoginScreen } = await import('../src/side-panel/components/LoginScreen')

    render(<LoginScreen onSuccess={() => {}} />)

    // The primary Google login button still renders — regression
    // check that the gate didn't accidentally hide both buttons.
    expect(screen.getByRole('button', { name: /Google/i })).toBeInTheDocument()

    // Button-count assertion is more robust than locale-specific
    // text matching: the contract of the gate is "one button or
    // two." If a future contributor adds an unrelated button this
    // count breaks loudly and the fix is intentional.
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('shows the picker button when WEB_OAUTH_CLIENT_ID is set, and clicking it sends AUTH_LOGIN_PICKER', async () => {
    vi.doMock('../src/shared/config', () => ({
      API_BASE_URL: 'http://localhost:3000',
      WS_URL: 'ws://localhost:3001',
      CURATE_URL: '',
      WEB_OAUTH_CLIENT_ID: 'fake-id',
    }))
    const { LoginScreen } = await import('../src/side-panel/components/LoginScreen')

    render(<LoginScreen currentUrl="https://example.com/lecture/42" onSuccess={() => {}} />)

    // Two buttons now: primary Google login + secondary picker.
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(2)

    // The secondary picker button is the one WITHOUT the aria-label
    // (primary sets aria-label={T.login.button} at LoginScreen.tsx:85).
    const pickerButton = buttons.find(b => !b.hasAttribute('aria-label'))
    expect(pickerButton).toBeDefined()

    fireEvent.click(pickerButton!)

    // sendMessage lives on globalThis.chrome from tests/setup.ts.
    // Cast through unknown for the same reason setup.ts does.
    const sendMessage = (globalThis as unknown as {
      chrome: { runtime: { sendMessage: ReturnType<typeof vi.fn> } }
    }).chrome.runtime.sendMessage
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'AUTH_LOGIN_PICKER',
      currentUrl: 'https://example.com/lecture/42',
    })
  })
})
