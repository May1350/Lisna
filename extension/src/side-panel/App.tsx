import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import type { SlideItem, User, QuotaSnapshot } from '../shared/types'
import { hasConsent, setConsent, getEnabled, onEnabledChange } from '../shared/storage'
import { ConsentModal } from './components/ConsentModal'
import { LoginScreen } from './components/LoginScreen'
import { OutlineView } from './components/OutlineView'
import { SessionHistory, type SessionSummary } from './components/SessionHistory'
import { NotesViewer } from './components/NotesViewer'
import { LiveTranscript } from './components/LiveTranscript'
import { ExportMenu } from './components/ExportMenu'
import { QuotaBanner } from './components/QuotaBanner'
import { TrialNudgeBanner } from './components/TrialNudgeBanner'
import { PanelHeader } from './components/PanelHeader'
import { SessionControls } from './components/SessionControls'
import { QuotaExhaustedIdle } from './components/QuotaExhaustedIdle'
import { TrialEndModal } from './components/TrialEndModal'
import { callApi, getCurrentUser, logout, ApiError } from './api-client'
import { useQuota } from './hooks/useQuota'
import { useTrial } from './hooks/useTrial'
import { useSession } from './hooks/useSession'
import { useT } from '../shared/i18n'
import { setFeedbackPrefill } from '../shared/feedback-prefill'
import type { Translations } from '../shared/i18n'

// Curate-error reasons where a "💡 Report" CTA actually adds value.
// Whitelisted (not blacklisted) so adding new reasons later requires
// an explicit decision: most new reasons trend toward
// user-resolvable (auth, quota, "no transcripts yet") and surfacing
// a feedback CTA on those would just create noise. Reasons in this
// list have one trait in common: the user reads the message, can't
// act on it, and we genuinely benefit from a per-occurrence report.
const ERROR_REPORTABLE = new Set<string>([
  'curator_failed',     // LLM blew up — opaque to user, valuable signal for us
  'timeout_no_signal',  // backend never came back — could be a real bug
  'request_failed',     // network/HTTP failure — could be transient OR real
])

// Big-square spinner shown when the user has triggered curate but no
// outline exists yet (first generation). Once an outline is in place the
// modal keeps rendering it underneath the spinning button label instead.
function CuratingState() {
  const T = useT()
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-10 text-center">
      <div className="relative w-12 h-12 mb-4">
        <span className="absolute inset-0 rounded-full border-4 border-paper-edge" />
        <span className="absolute inset-0 rounded-full border-4 border-ink-900 border-t-transparent animate-spin" />
      </div>
      <p className="text-sm font-medium text-ink-900">{T.curate.spinnerTitle}</p>
      <p className="text-xs text-ink-500 mt-1 max-w-xs leading-relaxed">
        {T.curate.spinnerHint}<br />
        {T.curate.timeHint}
      </p>
    </div>
  )
}

// Idle state shown after a session is active but before any outline has
// been produced. We replace the old "captions only" view with an explicit
// hint so the user knows what to do next: either keep watching (we'll
// curate on pause / end) or hit the manual button below.
function IdleSessionState({ videoPlaying }: { videoPlaying: boolean | null }) {
  const T = useT()
  // Idle hero per DESIGN.md (Concept 1+) — no emoji, mono uppercase
  // eyebrow with state-keyed status dot, body copy in token color.
  // Three states: recording (ok-green pulse), paused (ink-500), waiting
  // (ink-300). Body line shown only when there's something to say
  // beyond the eyebrow itself.
  let dotColor = 'bg-ink-300'
  let label = T.capture.waiting
  let body: React.ReactNode = null
  let pulsing = false
  if (videoPlaying === false) {
    dotColor = 'bg-ink-500'
    label = T.capture.pausedTitle
    body = T.capture.pausedHint
  } else if (videoPlaying === true) {
    dotColor = 'bg-ok-green'
    pulsing = true
    label = T.capture.recordingTitle
    const lines = T.capture.recordingHint.split('\n')
    body = lines.map((line, i) => (
      <span key={i}>
        {line}
        {i < lines.length - 1 && <br />}
      </span>
    ))
  }
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-10 text-center">
      <div className="flex items-center gap-2 mb-3">
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full ${dotColor} ${pulsing ? 'animate-pulse' : ''}`}
          aria-hidden
        />
        <span className="text-[10px] font-mono uppercase tracking-eyebrow text-ink-500">
          {label}
        </span>
      </div>
      {body && (
        <p className="text-xs text-ink-500 max-w-xs leading-relaxed">
          {body}
        </p>
      )}
    </div>
  )
}

// Map raw curate-failure reason keys to user-facing Japanese / English /
// etc. messages. Reasons come from a small set: the content script /
// curate handler emit them; the modal's watchdog adds its own
// (`timeout_no_signal`); anything else falls back to a generic
// retry message (better to be vague-but-helpful than to surface
// a debug key the user can't act on). Looks up T.curateError[reason]
// directly so that adding a new reason just requires extending the
// translation table.
function humanizeCurateError(reason: string, T: Translations): string {
  type ReasonKey = keyof Translations['curateError']
  const known = T.curateError as Record<string, string>
  const fallback = T.curateError.fallback
  return known[reason as ReasonKey] ?? fallback
}

// Small footer hint shown after the capture session has ended (user
// pressed ✕ 終了 OR the video reached its end naturally) but before
// the user has triggered a manual re-curate. Replaces the silent
// post-end empty space below the outline — without this users were
// confused about where to go next.
function PostSessionHint() {
  const T = useT()
  return (
    <div className="mx-3 mb-1 bg-terra-tint border border-terra-soft text-ink-900 text-xs px-3 py-2 rounded-[10px] leading-relaxed">
      <span className="font-semibold text-terra-700">{T.postSession.title}</span>{' '}
      {T.postSession.hint}
    </div>
  )
}

// Editable filename row shown above the export buttons. The curator
// auto-extracts a title (good default for most lectures), but each
// student organises their files differently — by date, by chapter
// number, by week, etc. Clicking the title pencil opens a small
// inline input; Enter / blur saves, Esc discards. Whitespace-only
// input falls back to the placeholder so we never produce a `.zip`
// with no name.
function EditableFilename({
  title, onChange, fallback,
}: {
  title: string
  onChange: (next: string) => void
  fallback: string
}) {
  const T = useT()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)
  // Refresh the draft when the parent's title changes (e.g. a new
  // outline_updated arrived from the backend) and we're not in the
  // middle of editing.
  useEffect(() => { if (!editing) setDraft(title) }, [title, editing])

  const save = () => {
    const next = draft.trim() || fallback
    onChange(next)
    setEditing(false)
  }
  const cancel = () => {
    setDraft(title)
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1.5 text-xs">
        <span className="text-ink-500 shrink-0">{T.export.fileName}</span>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
            else if (e.key === 'Escape') cancel()
          }}
          autoFocus
          className="flex-1 min-w-0 px-2 py-1 border border-ink-200 rounded text-xs focus:outline-none focus:border-ink-900 focus:ring-1 focus:ring-ink-900/15"
        />
      </div>
    )
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="w-full flex items-center gap-1.5 text-xs text-left hover:bg-paper-300 rounded px-1 py-1 transition group"
      title={T.export.fileNameTooltip}
    >
      <span className="text-ink-500 shrink-0">{T.export.fileName}</span>
      <span className="flex-1 min-w-0 truncate text-ink-900 font-medium">{title}</span>
      <span className="opacity-0 group-hover:opacity-100 text-ink-300 transition">✎</span>
    </button>
  )
}

// Cold-start snapshot of one storage key the mount-time effect can
// safely freeze: last-saved playback speed. The cachedQuota seed has
// moved to useQuota (it now reads `sh.cachedQuota` itself on mount —
// see hooks/useQuota.ts). The trial-pending key stays a separate
// focus-handler read since it can change between mount and the
// Stripe-return focus event. The token key is read fresh inside the
// auth effect for the same live-changes reason — see the BootStorage
// comment block below.
//
// `sh.token` is deliberately NOT cached in this snapshot. The token
// is the one mount-time storage value that LIVE-CHANGES (login flow
// writes it after mount); freezing it here caused a flicker
// regression — the auth effect re-runs on `user?.id` change after
// login, saw a stale `hasToken: false` from mount, and reset
// setUser(null) back to LoginScreen. The auth effect reads
// `sh.token` fresh on each run instead (rare — only on consented
// flip or user?.id change).
interface BootStorage {
  playback: unknown
}

export default function App() {
  const T = useT()
  const [consented, setConsented] = useState<boolean | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [bootStorage, setBootStorage] = useState<BootStorage | null>(null)
  // Most session-derived state (sessionId / slides / outline /
  // outlineUpdatedAt / transcripts / curating / curateError /
  // isCapturing / videoPlaying) now lives in useSession — composed
  // a few lines down once `ctx` provides isEmbed + parentUrl, and
  // `title` provides the filename fallback. The hook still exposes
  // every setter (leaky abstraction during Phase 3a) so applyEvent —
  // which stays in App.tsx during 3a — can mutate state through the
  // destructured setters. Phase 3b moves applyEvent into the hook
  // and the raw setters drop from the public return.
  const isCapturingRef = useRef(false)
  const videoPlayingRef = useRef<boolean | null>(null)
  const {
    quota, quotaBlocked, liveRemainingSecs, exhausted,
    setQuota, setQuotaBlocked, setLiveRemainingSecs,
    reset: resetQuota,
  } = useQuota({ isCapturingRef, videoPlayingRef })
  // (pendingAutoDownloadRef moved to useSession in Phase 5c step 3b
  // — it's hook-internal now since applyEvent lives there.)
  // Lecture title used for the export filename. Initial value is a
  // generic placeholder; we replace it with `outline.title` (the
  // curator-extracted lecture topic) the moment the first outline
  // arrives — either via the initial /v1/session GET or via the
  // outline_updated broadcast after a curate run. Without that
  // replacement every download landed as `講義ノート.zip` and a user
  // accumulating multiple lectures couldn't tell which file was which.
  const TITLE_FALLBACK = T.filename.fallback
  const [title, setTitle] = useState(TITLE_FALLBACK)
  // Mirror of the latest export-input fields. `applyEvent` is wrapped
  // in useCallback([isEmbed]) and would otherwise capture stale values
  // for sessionId / title / slides / parentUrl. Updating a ref each
  // render keeps the auto-download path reading current state without
  // making the callback re-create (which would re-mount the message
  // listeners every render).
  const exportCtxRef = useRef<{
    parentUrl: string | null
    sessionId: string | null
    title: string
    slides: SlideItem[]
  }>({ parentUrl: null, sessionId: null, title: '', slides: [] })
  const [enabled, setEnabledState] = useState<boolean>(true)
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(2)
  // Side-panel only: when set, the side panel renders NotesViewer for
  // this session instead of the SessionHistory list. Cleared by the
  // viewer's "back" action. Null in embed context (the modal has its
  // own session-driven outline rendering).
  const [viewingSession, setViewingSession] = useState<SessionSummary | null>(null)

  // Two contexts share this app:
  //   - embed:      iframe modal injected into the page (?embed=1&parentUrl=…)
  //                 → session view + in-modal login if not authed.
  //   - side-panel: Chrome's built-in side panel (no params) → account view.
  const ctx = useMemo(() => {
    const params = new URLSearchParams(location.search)
    const isEmbed = params.has('embed')
    const parentUrl = params.get('parentUrl')
    return { isEmbed, parentUrl }
  }, [])
  const { isEmbed, parentUrl } = ctx

  // Session state slice (sessionId / slides / outline / transcripts /
  // curating / isCapturing / videoPlaying) lives in useSession. The
  // hook owns the /v1/session GET hydrate, the WS connect-and-route,
  // the curating watchdog, applyEvent + its two transport listeners
  // (SP_BROADCAST + window.postMessage), the auto-download arm/fire
  // flag, and onTriggerCurate. setTitle is forwarded in so /v1/session
  // GET / outline_updated can adopt the curator-extracted title.
  // useQuota's setters flow in so applyEvent's quota_update /
  // quota_exceeded cases can write through; setQuota is the wrapper
  // that internally persists sh.cachedQuota.
  const {
    sessionId, slides, outline, outlineUpdatedAt, transcripts,
    curating, curateError, isCapturing, videoPlaying,
    hydrateFromLogin, onTriggerCurate, reset: resetSession,
  } = useSession({
    isEmbed, user, parentUrl,
    exportCtxRef,
    setTitle,
    titleFallback: TITLE_FALLBACK,
    setQuota, setQuotaBlocked, setLiveRemainingSecs,
  })

  // Single source of truth for the React-side auth wipe. Every piece
  // of session-derived state lives here — calling resetAuthState from
  // logout / 401 fallback / cross-context storage event leaves no
  // user-specific data lingering for the next sign-in to inherit.
  //
  // bootStorage.cachedQuota is also cleared here even though it lives
  // in storage (which logout() already wiped) — that's because the
  // React snapshot was frozen at mount and outlives the storage wipe.
  // Without this, the auth-me cached-quota seed at line 380 would
  // splash user-A's old quota into user-B's first paint when an
  // account switch happened in this same modal lifetime. We preserve
  // playback (per-device, not per-user) so the new user inherits the
  // playback-speed preference.
  // Forward-reference ref for useTrial's reset(). useTrial is composed
  // BELOW resetAuthState (it forwards onAuthExpired into resetAuthState,
  // which is a forward closure that resolves at fire-time, not at hook-
  // call time). The ref is sync'd to the latest reset() in the render
  // body just after useTrial destructure — same commit-phase-safe
  // pattern as exportCtxRef / isCapturingRef.
  const resetTrialRef = useRef<() => void>(() => {})
  const resetAuthState = useCallback(() => {
    setUser(null)
    resetQuota()
    resetTrialRef.current()
    resetSession()
    setViewingSession(null)
    // Title is App-owned (not in useSession's slice). Without an
    // explicit reset, the previous user's curated lecture title
    // would linger on the next user's first paint of the modal
    // until useSession's /v1/session GET fired and adopted either
    // the new outline.title or the fallback. Cheap to set here.
    setTitle(TITLE_FALLBACK)
  }, [resetQuota, resetSession, TITLE_FALLBACK])
  // Stable onAuthExpired identity for hooks that pass it as a dep
  // into their internal useEffect (useTrial's visibility handler
  // listener, future useAuth's storage listener). Without this, each
  // render would create a new arrow → tear down + re-add the host-
  // page listeners.
  const handleAuthExpired = useCallback(() => resetAuthState(), [resetAuthState])

  // Cross-context auth sync. When ANY extension surface — Options
  // page logout, switch-account flow, a side-panel logout in a second
  // window, DevTools storage.clear() — drops `sh.token`, this listener
  // mirrors the logout into our React state without the user having to
  // re-click logout in THIS surface too. Filtered on falsy `newValue`
  // (covers `undefined` from remove(), plus defensive coverage for any
  // future code path that writes null/'' to the key) so the login flow
  // (which SETS sh.token to a non-empty JWT) doesn't fire a bogus
  // reset right after a successful sign-in.
  useEffect(() => {
    const onChanged = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: chrome.storage.AreaName,
    ) => {
      if (area !== 'local') return
      if ('sh.token' in changes && !changes['sh.token'].newValue) {
        resetAuthState()
      }
    }
    chrome.storage.onChanged.addListener(onChanged)
    return () => chrome.storage.onChanged.removeListener(onChanged)
  }, [resetAuthState])

  useEffect(() => { void hasConsent().then(setConsented) }, [])
  // Wait until the user has explicitly consented before fetching the
  // session. Earlier deps `[consented]` made this re-run on every
  // consented flip — including the initial null→false on a fresh
  // user — issuing a needless AUTH_GET_USER round-trip and clobbering
  // any in-flight setUser the login flow had just performed.
  // Playback speed only — cachedQuota seed moved to useQuota.
  // `sh.token` is read fresh inside the auth effect on each run
  // (see BootStorage comment for the live-changes rationale).
  useEffect(() => {
    void chrome.storage.local.get('sh.playback').then((r) => {
      setBootStorage({ playback: r['sh.playback'] })
    })
  }, [])

  useEffect(() => {
    if (consented !== true || !bootStorage) return

    // (Cached-quota seed migrated to useQuota in Phase 5c step 1 —
    // useQuota reads `sh.cachedQuota` itself on mount; the `prev ??`
    // guard inside its setters means the seed never clobbers a
    // fresher /v1/auth/me result.)

    void (async () => {
      // Pre-flight token guard. Without a JWT, every authed call below
      // (auth-me, stream-audio, etc.) silently 401s and the modal sits
      // in a permanently-broken "logged in but nothing works" state.
      // If we've cached a user object from a previous session but the
      // token is gone (storage cleared, manual logout via DevTools,
      // expiry-then-eviction), force a clean re-login by dropping the
      // stale user — the LoginScreen will mount and the user can
      // re-auth in one click.
      //
      // Fresh read (NOT cached in bootStorage): the login flow writes
      // `sh.token` AFTER mount, and this effect re-runs on user?.id
      // change. A stale mount-time cache would clobber the just-
      // written token and bounce the user back to LoginScreen.
      const tokenStored = await chrome.storage.local.get('sh.token')
      const hasToken = typeof tokenStored['sh.token'] === 'string' && (tokenStored['sh.token'] as string).length > 0
      if (!hasToken) {
        // Drop any stale user record so the LoginScreen renders. The
        // /v1/auth/me call below is intentionally skipped — without a
        // token it would 401 on every cold mount and pollute the
        // console with a misleading "clearing stale auth" message
        // even when there was no auth to clear.
        void chrome.storage.local.remove('sh.user')
        setUser(null)
        return
      }
      const cur = await getCurrentUser()
      setUser(cur)

      // Fresh auth-me with the token we just confirmed exists. On 401
      // here, the token IS genuinely stale (signed by a rotated
      // JWT_SECRET, expired, or revoked) — only THEN do we drop
      // storage and bounce to LoginScreen.
      try {
        const r = await callApi<{ user: User; quota: QuotaSnapshot }>('/v1/auth/me', 'GET')
        if (r.user) setUser(r.user as User)
        if (r.quota) {
          // setQuota is useQuota's wrapper — it persists sh.cachedQuota
          // internally on every concrete-value call. Explicit
          // storage.local.set here was removed in Phase 5c step 3b
          // (single source of truth for cached-quota persistence).
          setQuota(r.quota)
          // Seed the header countdown to the backend-authoritative
          // value the moment auth-me lands rather than waiting for
          // the first stream-audio response.
          setLiveRemainingSecs(r.quota.remaining_secs)
        }
      } catch (e) {
        const status = e instanceof ApiError ? e.status : undefined
        if (status === 401) {
          console.warn('[App] /v1/auth/me 401 with token — clearing stale auth, prompting re-login')
          // logout() wipes the per-user storage keys (token, user,
          // cachedQuota, pendingTrialSession) via the SW; resetAuthState
          // mirrors that wipe into React state. The storage listener
          // above also fires on logout's removal, but resetAuthState is
          // idempotent so the double-call is harmless.
          await logout()
          resetAuthState()
        } else {
          console.warn('[App] /v1/auth/me failed; relying on cached quota if any', e instanceof Error ? e.message : e)
        }
      }
    })()
    // Re-run when user IDENTITY changes (null → logged-in or vice
    // versa). Without `user?.id` here the effect only ran once on
    // mount; if the user logged in via LoginScreen.onSuccess the
    // app would never refetch /v1/auth/me with the fresh token, so
    // quota stayed null and the QuotaExhaustedIdle card couldn't
    // render until the user manually reloaded the modal. We use the
    // ID rather than the whole user object because auth-me itself
    // calls setUser with a new object identity every time, which
    // would otherwise re-trigger the effect in an infinite loop.
    // bootStorage is also a dep so the effect waits for the batched
    // mount-time storage read before running its pre-flight check.
    // resetAuthState is stable (empty deps) so it doesn't churn the
    // effect — included for exhaustive-deps correctness only.
  }, [consented, user?.id, bootStorage, resetAuthState])

  // Keep the export-input ref in sync with the React state used by
  // the auto-download path inside applyEvent. Refs are commit-phase
  // safe to write from the render body — no useEffect needed.
  exportCtxRef.current = { parentUrl, sessionId, title, slides }

  // Mirror capture/play state into refs read by useQuota's 1 Hz tick.
  // The tick lives inside useQuota for its whole lifetime; refs are
  // the bridge from App.tsx-owned state to that long-lived interval
  // without forcing the interval to be torn down + rebuilt on each
  // state change. Same commit-phase-safe pattern as exportCtxRef.
  isCapturingRef.current = isCapturing
  videoPlayingRef.current = videoPlaying

  // ON/OFF state — only meaningful in the side-panel (account) view, but we
  // load + subscribe regardless so the source of truth is storage.
  useEffect(() => {
    void getEnabled().then(setEnabledState)
    const off = onEnabledChange(setEnabledState)
    return off
  }, [])

  // Initial playback speed from storage. Shared key with the options
  // page. Gated on bootStorage so we use the same one-shot batched
  // read instead of issuing a third storage IPC on cold start.
  useEffect(() => {
    if (!bootStorage) return
    const stored = bootStorage.playback
    if (typeof stored === 'number') setPlaybackSpeed(stored)
    else if (stored === 'auto' || stored === undefined) setPlaybackSpeed(2)
  }, [bootStorage])




  // (1 Hz live-remaining tick migrated to useQuota in Phase 5c step 1.
  // It now lives inside the hook and reads isCapturing / videoPlaying
  // from the refs sync'd in the render body below — see
  // isCapturingRef / videoPlayingRef. The hook's setInterval runs
  // unconditionally for the hook lifetime and early-returns when the
  // refs say "not capturing or paused"; CPU cost of one ref read per
  // second is imperceptible.)


  // Stripe Checkout creation takes a few hundred ms — surface that as
  // a busy state so the upgrade button (in QuotaBanner / QuotaExhaustedIdle
  // / SessionControls quota mode) can disable itself and avoid the
  // "did my click register?" double-press case. Resolves on either
  // success (tab opens) or error (alert).
  const [upgrading, setUpgrading] = useState(false)
  const onUpgrade = useCallback(async () => {
    if (upgrading) return
    setUpgrading(true)
    try {
      const r = await callApi<{ url: string }>('/v1/billing/checkout', 'POST', {})
      chrome.tabs.create({ url: r.url })
    } finally {
      setUpgrading(false)
    }
  }, [upgrading])

  // ── 2-hour trial flow ────────────────────────────────────────────
  // The Stripe-setup-mode Checkout, the cross-tab visibility-confirm
  // path, and the trial-end refetch all live in useTrial now. App.tsx
  // composes the hook and forwards quota/user setters; the 401 escape
  // hatch is wired through `handleAuthExpired` (a stable wrapper
  // around resetAuthState — Plan D orchestrator).
  const {
    trialActive, trialStarting, onTrialStart, onTrialResolved,
    reset: resetTrial,
  } = useTrial({
    user, consented, quota,
    setUser, setQuota, setLiveRemainingSecs,
    onAuthExpired: handleAuthExpired,
  })
  // Sync the forward-reference ref so resetAuthState can fan out to
  // useTrial's reset without listing resetTrial in its deps array
  // (which would TDZ — resetTrial is declared after resetAuthState).
  resetTrialRef.current = resetTrial

  const onClose = useCallback(() => {
    if (isEmbed) {
      window.parent.postMessage({ type: 'SH_CLOSE_MODAL' }, '*')
    } else {
      window.close()
    }
  }, [isEmbed])

  const onLogout = useCallback(async () => {
    // logout() wipes per-user storage keys via the SW. resetAuthState
    // synchronously mirrors the wipe into React state so the user sees
    // LoginScreen on the next frame without waiting for the storage
    // listener tick.
    await logout()
    resetAuthState()
  }, [resetAuthState])

  const onToggleEnabled = useCallback(async (next: boolean) => {
    // Optimistic — storage event will reconcile if it fails.
    setEnabledState(next)
    await chrome.runtime.sendMessage({ type: 'TOGGLE_ENABLED', enabled: next })
  }, [])

  const onSpeedChange = useCallback((speed: number) => {
    setPlaybackSpeed(speed)
    void chrome.storage.local.set({ 'sh.playback': speed })
    // Inform the parent content script so it can apply to the active video
    // immediately. Only meaningful in embed mode (modal inside the page).
    if (isEmbed) {
      window.parent.postMessage({ type: 'SH_SET_SPEED', speed }, '*')
    }
  }, [isEmbed])

  // Toggle the underlying video's play state. The modal lives inside
  // an iframe in the content tab; window.parent is the top frame, which
  // has a sh-parent listener that relays SET_PLAY to whichever child
  // iframe owns the actual <video>.
  const onSetPlay = useCallback((play: boolean) => {
    if (!isEmbed) return
    window.parent.postMessage({ source: 'sh-parent', type: 'SET_PLAY', play }, '*')
  }, [isEmbed])

  const onEnd = useCallback(async () => {
    // Stop the active capture in whichever tab the modal is hosted in.
    // Embed runs inside the page, so we don't have a direct tabId; the
    // SW forwards STOP_SESSION to the active tab via tabs.sendMessage.
    // Content script's STOP_SESSION handler:
    //   - pauses the <video>
    //   - runs final curate (user gets a wrap-up outline automatically)
    //   - broadcasts session_ended
    // We DON'T clear sessionId here — keeping it lets the user manually
    // re-curate (📝 ノートを生成) and export (⬇ .zip) using the data
    // accumulated up to this point. The session_ended broadcast flips
    // isCapturing → false which hides the 停止 button.
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.id !== undefined) {
      await chrome.runtime.sendMessage({ type: 'STOP_SESSION', tabId: tab.id })
    }
  }, [])

  if (consented === null) return null

  // Embed (in-page modal) — handles its own auth flow.
  if (isEmbed) {
    if (!consented) {
      return <ConsentModal onAccept={async () => { await setConsent(); setConsented(true) }} />
    }
    if (!user) {
      return (
        <LoginScreen
          currentUrl={parentUrl ?? undefined}
          onSuccess={(result) => {
            // setUser triggers the auth-me re-fetch effect; the
            // backend returned the session for this URL in the same
            // response, so apply it eagerly via useSession's
            // hydrateFromLogin (which mirrors the /v1/session GET
            // hydrate path verbatim minus the title side-effect, so
            // we still call setTitle here ourselves).
            setUser(result.user)
            if (result.currentSession) {
              const { outlineTitle } = hydrateFromLogin(result.currentSession)
              if (outlineTitle) setTitle(outlineTitle)
            }
          }}
        />
      )
    }
    const onJump = (ts: number) => {
      // Routing depends on context:
      //   - embed (modal-in-page): the modal is an iframe inside the
      //     content tab. window.parent is the top frame; the top-frame
      //     content script listens for sh-parent JUMP_TO and relays
      //     to whichever child iframe has the actual <video> (top
      //     frame for YouTube, an iframe for K-LMS / Vimeo).
      //   - side-panel: there's no parent window to talk to. Forward
      //     through the SW, which fans out to the active tab via
      //     chrome.tabs.sendMessage. The content script's existing
      //     runtime.onMessage JUMP_TO handler picks it up there.
      if (isEmbed) {
        window.parent.postMessage({ source: 'sh-parent', type: 'JUMP_TO', ts }, '*')
      } else {
        void chrome.runtime.sendMessage({ type: 'JUMP_TO_REQUEST', ts })
      }
    }
    const hasContent = !!outline?.sections.length
    const hasTranscripts = transcripts.length > 0
    return (
      <div className="min-h-screen flex flex-col bg-paper-200">
        <PanelHeader
          user={user}
          isEmbed
          playbackSpeed={playbackSpeed}
          onSpeedChange={onSpeedChange}
          onClose={onClose}
          onLogout={onLogout}
          liveRemainingSecs={liveRemainingSecs}
          trialActive={trialActive}
        />
        {/* QuotaBanner is suppressed when the QuotaExhaustedIdle card
            below would render — that card now embeds its own
            progress bar + reset note, so showing the compact banner
            above it would be a duplicate "you're at the limit"
            message stacked on the same screen. The banner stays for
            every other render path (warn 90-99%, blocked + has-content). */}
        {!(!hasContent && exhausted) && (
          // Active-trial users at 90-99 % see the trial-specific nudge
          // (one-click Pro 가입 via saved PM) instead of the regular
          // QuotaBanner (which routes to Stripe Checkout). At 100 % the
          // TrialEndModal takes over below, so this band is 90-99 only.
          trialActive && quota && quota.percent_used >= 90 && quota.percent_used < 100 ? (
            <TrialNudgeBanner
              quota={quota}
              onResolved={onTrialResolved}
              onFallbackCheckout={onUpgrade}
            />
          ) : (
            <QuotaBanner user={user} quota={quota} blocked={quotaBlocked} onUpgrade={onUpgrade} />
          )
        )}
        {curating && !hasContent ? (
          <CuratingState />
        ) : !hasContent ? (
          // When the user has no saved data on this URL AND they're at
          // their monthly cap, the default IdleSessionState ("press
          // play and we'll curate") is misleading — pressing play
          // would just produce zero captions. Replace with the
          // explicit limit-reached + upgrade card. For users with any
          // saved data (hasContent), the regular flow renders below;
          // their captures-disabled signal lives inside SessionControls.
          (exhausted && quota) ? (
            // Trial active + 100 % used → trial-end decision modal
            // (Pro 가입 / 가입 안함). Otherwise the regular exhausted
            // card. The modal renders a fixed-position overlay so we
            // don't try to compose it side-by-side.
            trialActive ? (
              <TrialEndModal onResolved={onTrialResolved} onFallbackCheckout={onUpgrade} />
            ) : (
              <QuotaExhaustedIdle
                user={user}
                quota={quota}
                onUpgrade={onUpgrade}
                upgrading={upgrading}
                onTrialStart={onTrialStart}
                trialStarting={trialStarting}
              />
            )
          ) : (
            // Render IdleSessionState as soon as the modal mounts — do
            // NOT wait for sessionId. The canonical session_id only
            // arrives after the FIRST chunk completes its STT roundtrip
            // (~10 s of audio + ~1-2 s STT = ~12 s). Gating the idle
            // state on sessionId means the user sees "処理中..." for 12 s
            // even though the video is already playing and we already
            // know the video state. The early video_state broadcasts in
            // startCapture flow into `videoPlaying` immediately, so the
            // pill flips to "🎙️ 録音中" the moment they press play.
            <IdleSessionState videoPlaying={videoPlaying} />
          )
        ) : (
          <OutlineView
            // Force remount when the session swaps (e.g. user
            // navigates to a different URL with a different prior
            // record). The internal "first content change" tracker
            // resets along with the timestamp seed, so the new
            // session's serverUpdatedAt correctly seeds the indicator
            // instead of being shadowed by the previous session's
            // already-consumed first-render slot.
            key={sessionId ?? 'no-session'}
            outline={outline}
            outlineUpdatedAt={outlineUpdatedAt}
            slides={slides}
            onJump={onJump}
            displayTitle={title}
          />
        )}
        {curateError && (
          <div className="mx-3 mb-1 bg-warn-red/5 border border-warn-red/40 text-warn-red text-xs px-3 py-2 rounded flex items-start gap-2">
            <span className="flex-1">{humanizeCurateError(curateError, T)}</span>
            {ERROR_REPORTABLE.has(curateError) && (
              <button
                type="button"
                onClick={() => {
                  // Build a prefilled bug report with everything we know
                  // about the failure. Anything sensitive (transcript
                  // content) stays local — only the error code, time, and
                  // the lecture URL ride along. The user reviews + edits
                  // before pressing Send on the Options page.
                  const ts = new Date().toLocaleString()
                  const lines = [
                    `[Auto] curate error: ${curateError}`,
                    `When: ${ts}`,
                    sessionId ? `Session: ${sessionId}` : null,
                    '',
                    '----',
                    '',
                  ].filter(Boolean).join('\n')
                  void (async () => {
                    await setFeedbackPrefill({
                      category: 'bug',
                      message: lines,
                      contextUrl: parentUrl ?? undefined,
                    })
                    await chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS_PAGE' })
                  })()
                }}
                className="shrink-0 text-[11px] font-medium text-warn-red hover:text-warn-red underline whitespace-nowrap"
              >
                {T.curateError.reportButton}
              </button>
            )}
          </div>
        )}
        {sessionId && isCapturing && (
          <LiveTranscript items={transcripts} videoPlaying={videoPlaying} />
        )}
        {sessionId && !isCapturing && hasContent && <PostSessionHint />}
        <div className="px-3 pb-3 space-y-2">
          {/* Show the regen button when EITHER:
           *   - live transcripts have arrived (active capture is producing content)
           *   - an outline already exists (re-opened modal on a previously-curated URL)
           * Previous condition required `hasTranscripts` only, which hid the button
           * when the user revisited a lecture they'd already curated — even though
           * the backend has all the transcripts in DB and re-curate is exactly what
           * they want. Reported by the user 2026-04-30.
           */}
          {sessionId && (hasContent || hasTranscripts) && (
            <button
              onClick={() => onTriggerCurate(hasContent)}
              disabled={curating}
              className="w-full bg-ink-900 hover:bg-ink-700 disabled:bg-ink-200 disabled:text-ink-500 text-paper-100 text-xs font-medium py-2 px-3 rounded-[10px] transition-colors flex items-center justify-center gap-1.5"
              title={T.curate.button_title}
            >
              {curating ? (
                <>
                  <span className="inline-block w-3 h-3 border-2 border-paper-100/30 border-t-paper-100 rounded-full animate-spin" />
                  {T.curate.button_busy}
                </>
              ) : (
                hasContent ? T.curate.button_regenerate : T.curate.button_generate
              )}
            </button>
          )}
          {/* Stop button only while capture is active. After session_ended
              (user-stop OR natural ended) we hide it but keep ExportMenu
              and 📝 ノートを生成 alive so the user can still produce
              and export notes from the data captured so far.
              Special case: when the user has saved data on this URL
              (sessionId set + hasContent) but is at their monthly cap,
              SessionControls re-purposes this slot for a gray
              captures-disabled card. The user gets ONE consistent
              place that explains why captures aren't running, instead
              of an empty space where the pause button used to be. */}
          {sessionId && (() => {
            // Reuse the top-level `exhausted` computed at component
            // root — keeps this branch in sync with the QuotaBanner
            // and QuotaExhaustedIdle gates above.
            if (isCapturing) {
              return (
                <SessionControls
                  isCapturing={isCapturing}
                  videoPlaying={videoPlaying}
                  onSetPlay={onSetPlay}
                  onEnd={onEnd}
                />
              )
            }
            if (exhausted && hasContent) {
              return (
                <SessionControls
                  isCapturing={false}
                  videoPlaying={videoPlaying}
                  onSetPlay={onSetPlay}
                  onEnd={onEnd}
                  quotaExhausted
                  userPlan={user?.plan}
                  onUpgrade={onUpgrade}
                />
              )
            }
            return null
          })()}
          {sessionId && hasContent && parentUrl && (
            <EditableFilename title={title} onChange={setTitle} fallback={TITLE_FALLBACK} />
          )}
          {sessionId && hasContent && parentUrl && (
            <ExportMenu
              sourceUrl={parentUrl}
              title={title}
              slides={slides}
              sessionId={sessionId}
            />
          )}
        </div>
      </div>
    )
  }

  // Side-panel (account) view: consent + auth flow lives here.
  if (!consented) return <ConsentModal onAccept={async () => { await setConsent(); setConsented(true) }} />
  // No currentUrl in the side panel — there's no parent video page; the
  // existing-session lookup isn't useful here.
  if (!user) return <LoginScreen onSuccess={(r) => setUser(r.user)} />

  // Notes viewer takes over the whole side panel surface when the user
  // has clicked into a history row. Mounted as its own subtree (no
  // shared header/banner) so the back button + lecture title can act
  // as the only chrome — keeps the read-mode reading-friendly.
  if (viewingSession) {
    return (
      <NotesViewer
        session={viewingSession}
        onBack={() => setViewingSession(null)}
        onAuthExpired={resetAuthState}
      />
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-paper-200">
      <PanelHeader
        user={user}
        isEmbed={false}
        enabled={enabled}
        onToggleEnabled={onToggleEnabled}
        onClose={onClose}
        onLogout={onLogout}
        trialActive={trialActive}
      />
      {trialActive && quota && quota.percent_used >= 90 && quota.percent_used < 100 ? (
        <TrialNudgeBanner
          quota={quota}
          onResolved={onTrialResolved}
          onFallbackCheckout={onUpgrade}
        />
      ) : trialActive && exhausted ? (
        // Trial at 100 % — TrialEndModal owns the CTA (one-click via
        // saved PM). Suppress QuotaBanner so the user doesn't see its
        // "Stripe Checkout" CTA flash for one render before the modal
        // mounts, which would route trial users to the wrong flow.
        null
      ) : (
        <QuotaBanner user={user} quota={quota} blocked={quotaBlocked} onUpgrade={onUpgrade} />
      )}
      <div className="px-3 pt-3 pb-2 text-xs text-ink-700 leading-relaxed border-b border-paper-edge">
        {(() => {
          // inlineHint contains "{icon}" — substitute the bold icon
          // span at the placeholder location. Split-and-render keeps
          // the icon styled while letting locales decide where in the
          // sentence it appears.
          const tokens = T.sidePanel.inlineHint.split('{icon}')
          return tokens.map((part, i) => (
            <span key={i}>
              {part}
              {i < tokens.length - 1 && (
                <span className="font-semibold">{T.sidePanel.inlineHintIcon}</span>
              )}
            </span>
          ))
        })()}
      </div>
      <SessionHistory
        onAuthExpired={resetAuthState}
        onView={setViewingSession}
      />
    </div>
  )
}
