// Regression coverage for useQuota (Phase 5c step 1). Two cases that
// would catch the most obvious failure modes after the extraction:
//   1. The 1 Hz tick actually decrements liveRemainingSecs once per
//      second when the refs say "actively capturing AND video
//      playing" — and stops decrementing when either flag is false.
//   2. The cold-start cached-quota seed in chrome.storage.local picks
//      up the snapshot into both quota AND liveRemainingSecs, but
//      only when state is still null (prev ?? cached guard).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useQuota } from '../src/side-panel/hooks/useQuota'
import type { QuotaSnapshot } from '../src/shared/types'

const mockQuota: QuotaSnapshot = {
  used_secs: 60,
  limit_secs: 1200,
  remaining_secs: 60,
  percent_used: 5,
  plan: 'free',
}

describe('useQuota', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: storage returns empty (no cached quota). Per-test
    // overrides below stub the cached-quota path with concrete data.
    const chrome = (globalThis as unknown as { chrome: { storage: { local: { get: ReturnType<typeof vi.fn> } } } }).chrome
    chrome.storage.local.get.mockImplementation(() => Promise.resolve({}))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('decrements liveRemainingSecs once per second while capturing + playing; freezes when either flag is false', async () => {
    vi.useFakeTimers()
    const isCapturingRef = { current: false }
    const videoPlayingRef = { current: null as boolean | null }
    const { result } = renderHook(() => useQuota({ isCapturingRef, videoPlayingRef }))

    // Seed quota directly via the returned setter (mirrors what
    // applyEvent does on a quota_update event in App.tsx today).
    act(() => {
      result.current.setQuota(mockQuota)
      result.current.setLiveRemainingSecs(mockQuota.remaining_secs)
    })
    expect(result.current.liveRemainingSecs).toBe(60)

    // Flags off → ticks no-op.
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(result.current.liveRemainingSecs).toBe(60)

    // Flip flags on → ticks decrement once per second.
    isCapturingRef.current = true
    videoPlayingRef.current = true
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(result.current.liveRemainingSecs).toBe(57)

    // Pause the video → ticks stop where they are.
    videoPlayingRef.current = false
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(result.current.liveRemainingSecs).toBe(57)
  })

  it('seeds quota + liveRemainingSecs from sh.cachedQuota on mount when present and fresh', async () => {
    const chrome = (globalThis as unknown as { chrome: { storage: { local: { get: ReturnType<typeof vi.fn> } } } }).chrome
    chrome.storage.local.get.mockImplementation((key: string) => {
      if (key === 'sh.cachedQuota') {
        return Promise.resolve({
          'sh.cachedQuota': { quota: mockQuota, ts: Date.now() },
        })
      }
      return Promise.resolve({})
    })

    const isCapturingRef = { current: false }
    const videoPlayingRef = { current: null as boolean | null }
    const { result } = renderHook(() => useQuota({ isCapturingRef, videoPlayingRef }))

    // The seed runs in a useEffect that awaits a promise; flush
    // microtasks so the .then handler runs before we assert.
    await act(async () => { await Promise.resolve() })

    expect(result.current.quota).toEqual(mockQuota)
    expect(result.current.liveRemainingSecs).toBe(mockQuota.remaining_secs)
  })
})
