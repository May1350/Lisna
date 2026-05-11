// Regression coverage for useTrial (Phase 5c step 2). One case:
// the visibility/focus handler that finalises a pending trial setup
// after the user returns from the Stripe tab. This is the most
// complex path inside useTrial (storage read → dynamic-imported
// trialConfirm → /v1/auth/me refetch → write-through to the
// quota/user setters → storage cleanup), and the one regression we
// most need to guard.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useTrial } from '../src/side-panel/hooks/useTrial'
import type { QuotaSnapshot, User } from '../src/shared/types'

const mockUser: User = {
  id: 'user-1',
  email: 'tester@lisna.invalid',
  plan: 'free',
}
const mockQuota: QuotaSnapshot = {
  used_secs: 60,
  limit_secs: 7200,
  remaining_secs: 7140,
  percent_used: 0.83,
  plan: 'free',
  trial_active: true,
}

interface ChromeStorageMock {
  get: ReturnType<typeof vi.fn>
  set: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
}

function getChrome(): {
  storage: { local: ChromeStorageMock }
  runtime: { sendMessage: ReturnType<typeof vi.fn> }
  tabs: { create: ReturnType<typeof vi.fn> }
} {
  // Use `as any` here because the setup.ts mock surface is narrow on
  // purpose — full chrome typings are huge.
  return (globalThis as unknown as { chrome: ReturnType<typeof getChrome> }).chrome
}

describe('useTrial — visibility handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const chrome = getChrome()

    // Pre-populate storage: pending trial session exists.
    chrome.storage.local.get.mockImplementation((key: string) => {
      if (key === 'sh.pendingTrialSession') {
        return Promise.resolve({ 'sh.pendingTrialSession': 'sess-pending-123' })
      }
      return Promise.resolve({})
    })
    chrome.storage.local.set.mockResolvedValue(undefined)
    chrome.storage.local.remove.mockResolvedValue(undefined)

    // Match by path so the trialConfirm call AND the /v1/auth/me
    // refetch both get plausible responses.
    chrome.runtime.sendMessage.mockImplementation((msg: { type: string; path?: string }) => {
      if (msg.type === 'API_FETCH' && msg.path === '/v1/trial/confirm') {
        return Promise.resolve({ ok: true, data: { ok: true, expires_at: '2026-12-31', limit_secs: 7200 } })
      }
      if (msg.type === 'API_FETCH' && msg.path === '/v1/auth/me') {
        return Promise.resolve({ ok: true, data: { user: mockUser, quota: mockQuota } })
      }
      return Promise.resolve({ ok: true, data: null })
    })

    // jsdom default visibilityState is 'visible'; assert explicitly.
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      writable: true,
      configurable: true,
    })
  })

  it('on mount with pending session: trialConfirm + /v1/auth/me, then fans out to setters + removes pending key', async () => {
    // Build mocked setter args so we can assert the write-through.
    const setUser = vi.fn()
    const setQuota = vi.fn()
    const setLiveRemainingSecs = vi.fn()
    const onAuthExpired = vi.fn()

    renderHook(() => useTrial({
      user: mockUser,
      consented: true,
      quota: null,
      setUser,
      setQuota,
      setLiveRemainingSecs,
      onAuthExpired,
    }))

    // The effect kicks off onFocusOrVisible() on mount; it uses
    // chained dynamic imports + awaited storage calls. A two-step
    // microtask flush is enough — the test fails fast if more is
    // needed (which would itself be a refactor regression).
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })

    // Storage key was consumed (so subsequent visibility events
    // don't re-fire trialConfirm).
    const chrome = getChrome()
    expect(chrome.storage.local.remove).toHaveBeenCalledWith('sh.pendingTrialSession')

    // Setters were invoked with the refetched payload.
    expect(setQuota).toHaveBeenCalledWith(mockQuota)
    expect(setLiveRemainingSecs).toHaveBeenCalledWith(mockQuota.remaining_secs)
    expect(setUser).toHaveBeenCalledWith(mockUser)

    // 401 path NOT taken (success case).
    expect(onAuthExpired).not.toHaveBeenCalled()
  })
})
