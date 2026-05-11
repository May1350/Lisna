// Auth state slice — extracted from App.tsx in Phase 5c step 4.
// Owns:
//   - user state (the only consumer of the JWT identity).
//   - chrome.storage.onChanged listener for sh.token (cross-context
//     auth sync: Options-page logout / switch-account / DevTools
//     storage clear all fire here).
//   - the /v1/auth/me effect (with pre-flight token guard, success
//     write-through to user + quota setters, 401 fallback).
//
// Does NOT own:
//   - the quota / liveRemainingSecs slices themselves — useAuth
//     writes to them via setQuota / setLiveRemainingSecs args.
//   - the reset orchestration — useAuth has its own slice reset(),
//     App.tsx's resetAll fans out to all four hooks.
//
// Plan D orchestrator pattern: useAuth has no knowledge of its
// sibling hooks. The storage listener and the 401 path both call
// onAuthExpired() (an arg supplied by App.tsx, wired to resetAll)
// so the responsibility for fanning out the wipe stays at the
// orchestrator level.
import { useCallback, useEffect, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { ApiError, callApi, getCurrentUser, logout } from '../api-client'
import type { QuotaSnapshot, User } from '../../shared/types'

export interface UseAuthArgs {
  consented: boolean | null
  // App.tsx passes resetAll here; useAuth invokes it from the
  // storage listener (when sh.token is cleared by another context)
  // and from the auth-me 401 catch.
  onAuthExpired: () => void
  // useQuota's setters. The auth-me success path writes through
  // them so a fresh /v1/auth/me payload seeds quota + the header
  // countdown without auth caring which hook owns the state.
  setQuota: Dispatch<SetStateAction<QuotaSnapshot | null>>
  setLiveRemainingSecs: Dispatch<SetStateAction<number | null>>
}

export interface UseAuthReturn {
  user: User | null
  // Exposed for the LoginScreen.onSuccess eager-apply path in
  // App.tsx and for useTrial's setUser arg (trial-confirm refetch
  // writes through this).
  setUser: (u: User | null) => void
  reset: () => void
}

export function useAuth({
  consented, onAuthExpired, setQuota, setLiveRemainingSecs,
}: UseAuthArgs): UseAuthReturn {
  const [user, setUser] = useState<User | null>(null)

  // Cross-context auth sync. When ANY extension surface — Options
  // page logout, switch-account flow, a side-panel logout in a
  // second window, DevTools storage.clear() — drops `sh.token`,
  // this listener fires onAuthExpired() so the orchestrator can
  // fan out the reset across every hook. Filtered on falsy
  // `newValue` (covers `undefined` from remove(), plus defensive
  // coverage for any future code path that writes null / '' to
  // the key) so the login flow (which SETS sh.token to a non-empty
  // JWT) doesn't fire a bogus reset right after a successful sign-in.
  useEffect(() => {
    const onChanged = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: chrome.storage.AreaName,
    ) => {
      if (area !== 'local') return
      if ('sh.token' in changes && !changes['sh.token'].newValue) {
        onAuthExpired()
      }
    }
    chrome.storage.onChanged.addListener(onChanged)
    return () => chrome.storage.onChanged.removeListener(onChanged)
  }, [onAuthExpired])

  // Auth-me effect. Re-runs when consent flips or when user
  // IDENTITY changes (null → logged-in or vice versa). Using
  // `user?.id` rather than `user` itself prevents the infinite
  // loop where each successful /v1/auth/me call invokes setUser
  // with a new object identity, which would re-trigger this
  // effect under whole-user-object deps.
  useEffect(() => {
    if (consented !== true) return

    void (async () => {
      // Pre-flight token guard. Without a JWT, every authed call
      // below silently 401s and the modal sits in a permanently-
      // broken "logged in but nothing works" state. If we've cached
      // a user object from a previous session but the token is gone
      // (storage cleared, manual logout via DevTools, expiry-then-
      // eviction), force a clean re-login by dropping the stale
      // user — the LoginScreen will mount and the user can re-auth
      // in one click.
      const tokenStored = await chrome.storage.local.get('sh.token')
      const hasToken = typeof tokenStored['sh.token'] === 'string'
        && (tokenStored['sh.token'] as string).length > 0
      if (!hasToken) {
        // Drop any stale user record so the LoginScreen renders.
        // The /v1/auth/me call below is intentionally skipped —
        // without a token it would 401 on every cold mount and
        // pollute the console with a misleading "clearing stale
        // auth" message even when there was no auth to clear.
        void chrome.storage.local.remove('sh.user')
        setUser(null)
        return
      }
      const cur = await getCurrentUser()
      setUser(cur)

      // Fresh auth-me with the token we just confirmed exists. On
      // 401 here, the token IS genuinely stale (signed by a rotated
      // JWT_SECRET, expired, or revoked) — only THEN do we drop
      // storage and bounce to LoginScreen.
      try {
        const r = await callApi<{ user: User; quota: QuotaSnapshot }>('/v1/auth/me', 'GET')
        if (r.user) setUser(r.user as User)
        if (r.quota) {
          // setQuota is useQuota's wrapper — it persists
          // sh.cachedQuota internally on every concrete value.
          setQuota(r.quota)
          // Seed the header countdown to the backend-authoritative
          // value the moment auth-me lands rather than waiting for
          // the first stream-audio response.
          setLiveRemainingSecs(r.quota.remaining_secs)
        }
      } catch (e) {
        const status = e instanceof ApiError ? e.status : undefined
        if (status === 401) {
          // eslint-disable-next-line no-console
          console.warn('[useAuth] /v1/auth/me 401 with token — clearing stale auth, prompting re-login')
          // logout() wipes the per-user storage keys (token, user,
          // cachedQuota, pendingTrialSession) via the SW. The
          // storage listener above will then ALSO fire and call
          // onAuthExpired — idempotent so the double-call is
          // harmless, but we invoke onAuthExpired here too so the
          // React state wipe happens synchronously rather than
          // racing the storage event.
          await logout()
          onAuthExpired()
        } else {
          // eslint-disable-next-line no-console
          console.warn('[useAuth] /v1/auth/me failed; relying on cached quota if any', e instanceof Error ? e.message : e)
        }
      }
    })()
  }, [consented, user?.id, onAuthExpired, setQuota, setLiveRemainingSecs])

  const reset = useCallback(() => {
    setUser(null)
  }, [])

  return { user, setUser, reset }
}
