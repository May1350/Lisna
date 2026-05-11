// Regression coverage for useAuth (Phase 5c step 4). The most
// load-bearing post-split contract is the chrome.storage.onChanged
// listener: when ANY extension surface (Options-page logout,
// switch-account flow, DevTools clear) drops `sh.token`, the
// listener must fire onAuthExpired so the App.tsx orchestrator can
// fan out the reset. Conversely, a SET on sh.token (login flow
// writing a fresh JWT) must NOT trigger the listener — that would
// nuke the just-arrived auth state on every successful sign-in.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useAuth } from '../src/side-panel/hooks/useAuth'

type ChromeStorageOnChanged = {
  addListener: ReturnType<typeof vi.fn>
  removeListener: ReturnType<typeof vi.fn>
}

function getChrome(): {
  storage: { onChanged: ChromeStorageOnChanged; local: { get: ReturnType<typeof vi.fn> } }
} {
  return (globalThis as unknown as { chrome: ReturnType<typeof getChrome> }).chrome
}

describe('useAuth — storage.onChanged sh.token listener', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Pre-empt the auth-me effect from doing real work: pretend no
    // token is stored, so the effect short-circuits at the pre-flight
    // guard and never reaches /v1/auth/me.
    const chrome = getChrome()
    chrome.storage.local.get.mockImplementation(() => Promise.resolve({}))
  })

  it('fires onAuthExpired when sh.token transitions to falsy; ignores SET to a non-empty JWT', () => {
    const onAuthExpired = vi.fn()

    renderHook(() => useAuth({
      consented: true,
      onAuthExpired,
      setQuota: vi.fn(),
      setLiveRemainingSecs: vi.fn(),
    }))

    const chrome = getChrome()
    // Extract the listener registered at mount.
    expect(chrome.storage.onChanged.addListener).toHaveBeenCalledTimes(1)
    const listener = chrome.storage.onChanged.addListener.mock.calls[0][0] as (
      changes: Record<string, chrome.storage.StorageChange>,
      area: chrome.storage.AreaName,
    ) => void

    // Removal: sh.token cleared (e.g. SW logout).
    listener({ 'sh.token': { oldValue: 'jwt.abc', newValue: undefined } }, 'local')
    expect(onAuthExpired).toHaveBeenCalledTimes(1)

    // SET: login flow writing a fresh JWT — must NOT fire.
    listener({ 'sh.token': { oldValue: undefined, newValue: 'jwt.def' } }, 'local')
    expect(onAuthExpired).toHaveBeenCalledTimes(1)

    // Different area (sync, managed) → ignore even on falsy.
    listener({ 'sh.token': { oldValue: 'jwt.abc', newValue: undefined } }, 'sync')
    expect(onAuthExpired).toHaveBeenCalledTimes(1)

    // Different key → ignore.
    listener({ 'sh.cachedQuota': { oldValue: { quota: {} }, newValue: undefined } }, 'local')
    expect(onAuthExpired).toHaveBeenCalledTimes(1)
  })
})
