// Quota state slice — extracted from App.tsx in Phase 5c step 1.
// Owns:
//   - quota / quotaBlocked / liveRemainingSecs state.
//   - the `exhausted` derived flag (single source of truth used by
//     QuotaBanner / QuotaExhaustedIdle / SessionControls).
//   - the cold-start cached-quota seed (was previously batched into
//     App.tsx's bootStorage read).
//   - the 1 Hz live-remaining tick.
//
// Does NOT own:
//   - persistence write of `sh.cachedQuota` after a fresh quota lands
//     (applyEvent in App.tsx still does the write directly during
//     phase 1; consolidation moves to Phase 3b when applyEvent migrates
//     to useSession).
//   - the auth-me effect's quota seeding — that path stays in App.tsx
//     for phase 1; Phase 4 (useAuth) inverts the dependency.
import { useCallback, useEffect, useState } from 'react'
import type { RefObject } from 'react'
import type { QuotaSnapshot } from '../../shared/types'

export interface UseQuotaArgs {
  // Refs the 1 Hz tick reads at fire-time. Passing them as refs (rather
  // than as raw state values) lets the interval live for the whole
  // hook lifetime instead of being torn down + rebuilt on every state
  // change. CPU cost of one ref read per second when idle is
  // imperceptible; the alternative (deps-based teardown) would re-
  // schedule the next tick at ~0 ms-after-the-last-fire and drift the
  // wall-clock cadence on rapid state churn.
  isCapturingRef: RefObject<boolean>
  videoPlayingRef: RefObject<boolean | null>
}

export interface UseQuotaReturn {
  quota: QuotaSnapshot | null
  quotaBlocked: boolean
  liveRemainingSecs: number | null
  // Derived from quota+quotaBlocked. Three triggers, any one of which
  // counts (matches App.tsx pre-split semantics verbatim):
  //   1. server forced 402 (quotaBlocked) — authoritative
  //   2. percent_used rounded >= 100 — backend's own rounding
  //   3. remaining_secs <= 0 — covers the rounding-down edge where
  //      backend reports percent_used=99 (Math.round(99.4)) but
  //      remaining_secs=0.
  exhausted: boolean
  setQuota: (q: QuotaSnapshot | null) => void
  setQuotaBlocked: (b: boolean) => void
  setLiveRemainingSecs: (n: number | null) => void
  // Called by App.tsx's resetAll orchestrator on logout / 401.
  reset: () => void
}

// Cached-quota TTL — 30 min bridges network blips, short enough that
// a Pro upgrade taking effect doesn't keep the user pinned behind a
// stale "exhausted" surface.
const CACHED_QUOTA_TTL_MS = 30 * 60 * 1000

export function useQuota({ isCapturingRef, videoPlayingRef }: UseQuotaArgs): UseQuotaReturn {
  const [quota, setQuota] = useState<QuotaSnapshot | null>(null)
  const [quotaBlocked, setQuotaBlocked] = useState(false)
  const [liveRemainingSecs, setLiveRemainingSecs] = useState<number | null>(null)

  const exhausted = quotaBlocked || (!!quota && (quota.percent_used >= 100 || quota.remaining_secs <= 0))

  // Cold-start cached-quota seed. Runs once on mount; the `prev ??`
  // guards on both setters mean a fresher auth-me / quota_update
  // landing first wins, and the seed only applies when state is
  // still null. So this effect is safe to run unconditionally
  // regardless of consent / auth state (it has zero side effect on
  // unauthenticated mounts — storage read returns nothing useful).
  useEffect(() => {
    let cancelled = false
    void chrome.storage.local.get('sh.cachedQuota').then((r) => {
      if (cancelled) return
      const cached = r['sh.cachedQuota'] as { quota?: QuotaSnapshot; ts?: number } | undefined
      if (
        cached?.quota
        && typeof cached.ts === 'number'
        && Date.now() - cached.ts <= CACHED_QUOTA_TTL_MS
      ) {
        setQuota((prev) => prev ?? cached.quota!)
        setLiveRemainingSecs((prev) => prev ?? cached.quota!.remaining_secs)
      }
    })
    return () => { cancelled = true }
  }, [])

  // 1 Hz tick. Decrements liveRemainingSecs once per second while the
  // session is actively capturing AND the video is playing — pause /
  // scrub / not-capturing freezes the counter where it is. The next
  // chunk's quota_update will resync to the backend's authoritative
  // value, so any tiny drift is bounded by the ~10 s chunk cadence.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (!isCapturingRef.current || videoPlayingRef.current !== true) return
      setLiveRemainingSecs((prev) => {
        if (prev === null) return prev
        return prev > 0 ? prev - 1 : 0
      })
    }, 1000)
    return () => window.clearInterval(id)
  }, [isCapturingRef, videoPlayingRef])

  const reset = useCallback(() => {
    setQuota(null)
    setQuotaBlocked(false)
    setLiveRemainingSecs(null)
  }, [])

  return {
    quota,
    quotaBlocked,
    liveRemainingSecs,
    exhausted,
    setQuota,
    setQuotaBlocked,
    setLiveRemainingSecs,
    reset,
  }
}
