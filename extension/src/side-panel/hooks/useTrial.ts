// Trial state slice — extracted from App.tsx in Phase 5c step 2.
// Owns:
//   - trialStarting busy flag for the Stripe-Checkout-create path.
//   - the `trialActive` derived flag (re-exposed for convenience so
//     consumers don't re-derive from quota).
//   - the visibility/focus handler that finalises a pending trial
//     setup after the user returns from the Stripe tab.
//   - onTrialStart (Stripe Checkout create) + onTrialResolved
//     (refetch /v1/auth/me after the trial-end modal resolves).
//
// Cross-hook coordination (Plan D: App.tsx orchestrator): the setters
// (setUser, setQuota, setLiveRemainingSecs) arrive as args from
// App.tsx — useTrial doesn't know which hook owns each slice. The
// 401 fallout path calls onAuthExpired() (also passed in by App.tsx,
// which wires it to resetAll) instead of resetting state itself.
//
// Dynamic imports of trialStart / trialConfirm / logout are preserved
// from the pre-split shape — they keep the trial code out of the
// cold-start critical path (a user who never starts a trial never
// pays the parse cost for those modules). Same pattern as in
// App.tsx pre-split; relocated verbatim.
import { useCallback, useEffect, useState } from 'react'
import { ApiError, callApi } from '../api-client'
import { reportError } from '../../shared/errors'
import type { QuotaSnapshot, User } from '../../shared/types'

const PENDING_TRIAL_KEY = 'sh.pendingTrialSession'

export interface UseTrialArgs {
  user: User | null
  consented: boolean | null
  quota: QuotaSnapshot | null
  setUser: (u: User | null) => void
  setQuota: (q: QuotaSnapshot | null) => void
  setLiveRemainingSecs: (n: number | null) => void
  // 401 escape hatch. App.tsx passes resetAll here so a JWT-expiry
  // during trial-confirm or onTrialResolved fans out to every hook.
  onAuthExpired: () => void
}

export interface UseTrialReturn {
  trialActive: boolean
  trialStarting: boolean
  onTrialStart: () => Promise<void>
  onTrialResolved: (result: 'subscribed' | 'declined') => Promise<void>
  reset: () => void
}

export function useTrial({
  user, consented, quota,
  setUser, setQuota, setLiveRemainingSecs,
  onAuthExpired,
}: UseTrialArgs): UseTrialReturn {
  const [trialStarting, setTrialStarting] = useState(false)

  const trialActive = quota?.trial_active === true

  const onTrialStart = useCallback(async () => {
    if (trialStarting) return
    setTrialStarting(true)
    try {
      const { trialStart } = await import('../api-client')
      const r = await trialStart()
      // Persist BEFORE opening the tab — if the user closes the
      // modal mid-redirect, we still know to confirm on return.
      await chrome.storage.local.set({ [PENDING_TRIAL_KEY]: r.session_id })
      chrome.tabs.create({ url: r.url })
    } catch (e) {
      void reportError(e, { context: 'trial-start', severity: 'error' })
    } finally {
      setTrialStarting(false)
    }
  }, [trialStarting])

  // Visibilitychange + focus poll: when the modal regains focus
  // after the user closed the Stripe tab, finalise any pending
  // trial setup. Idempotent — the backend handles duplicate
  // confirms with ON CONFLICT DO NOTHING. Always refetches
  // /v1/auth/me afterwards so the freshly-active trial flips
  // QuotaExhaustedIdle off and the regular UI back on.
  useEffect(() => {
    if (consented !== true || !user) return
    const onFocusOrVisible = async () => {
      if (document.visibilityState !== 'visible') return
      const stored = await chrome.storage.local.get(PENDING_TRIAL_KEY)
      const sessionId = stored[PENDING_TRIAL_KEY]
      if (typeof sessionId !== 'string' || sessionId.length === 0) return
      try {
        const { trialConfirm } = await import('../api-client')
        await trialConfirm(sessionId)
        await chrome.storage.local.remove(PENDING_TRIAL_KEY)
        // Refetch quota so UI flips immediately.
        const r = await callApi<{ user: User; quota: QuotaSnapshot }>('/v1/auth/me', 'GET')
        if (r.quota) {
          // setQuota is useQuota's wrapper — persists sh.cachedQuota
          // internally; the explicit storage.set was removed in
          // Phase 5c step 3b (single source of truth).
          setQuota(r.quota)
          setLiveRemainingSecs(r.quota.remaining_secs)
        }
        if (r.user) setUser(r.user as User)
      } catch (e) {
        // Most common case: user cancelled the Stripe page → confirm
        // returns 4xx because the SetupIntent didn't succeed. Clear
        // the pending stash either way so we don't retry forever.
        await chrome.storage.local.remove(PENDING_TRIAL_KEY)
        // 401 here = JWT expired between modal mount and Stripe return.
        // Drop stale auth state via the orchestrator so LoginScreen
        // takes over across every hook.
        const status = e instanceof ApiError ? e.status : undefined
        if (status === 401) {
          const { logout } = await import('../api-client')
          await logout()
          onAuthExpired()
        }
        void reportError(e, { context: 'trial-confirm', severity: 'warning', silent: true })
      }
    }
    document.addEventListener('visibilitychange', onFocusOrVisible)
    window.addEventListener('focus', onFocusOrVisible)
    // Run once on mount in case the modal mounted AFTER the tab returned.
    void onFocusOrVisible()
    return () => {
      document.removeEventListener('visibilitychange', onFocusOrVisible)
      window.removeEventListener('focus', onFocusOrVisible)
    }
  }, [consented, user, setUser, setQuota, setLiveRemainingSecs, onAuthExpired])

  // Re-fetch user + quota after the trial-end modal resolves (Pro
  // 가입 OR 가입 안함). Both outcomes change the auth-me response
  // so the UI swaps from TrialEndModal → either Pro recording flow
  // or Free QuotaExhaustedIdle.
  const onTrialResolved = useCallback(async (_result: 'subscribed' | 'declined') => {
    try {
      const r = await callApi<{ user: User; quota: QuotaSnapshot }>('/v1/auth/me', 'GET')
      if (r.quota) {
        setQuota(r.quota)
        setLiveRemainingSecs(r.quota.remaining_secs)
        void chrome.storage.local.set({ 'sh.cachedQuota': { quota: r.quota, ts: Date.now() } })
      }
      if (r.user) setUser(r.user as User)
    } catch (e) {
      const status = e instanceof ApiError ? e.status : undefined
      if (status === 401) {
        const { logout } = await import('../api-client')
        await logout()
        onAuthExpired()
      }
      void reportError(e, { context: 'trial-resolved-refetch', severity: 'warning', silent: true })
    }
  }, [setUser, setQuota, setLiveRemainingSecs, onAuthExpired])

  // Called by App.tsx's resetAll orchestrator on logout / 401. Clears
  // the busy flag and the pending-session storage pointer (the SW's
  // logout() also wipes PER_USER_STORAGE_KEYS which includes this
  // key, but a redundant remove is harmless and keeps the orchestrator
  // contract symmetrical across all four hooks).
  const reset = useCallback(() => {
    setTrialStarting(false)
    void chrome.storage.local.remove(PENDING_TRIAL_KEY)
  }, [])

  return { trialActive, trialStarting, onTrialStart, onTrialResolved, reset }
}
