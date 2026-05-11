// Session state slice — extracted from App.tsx in Phase 5c step 3a.
// Owns:
//   - sessionId / slides / outline / outlineUpdatedAt / transcripts /
//     curating / curateError / isCapturing / videoPlaying state.
//   - the /v1/session GET hydrate effect (embed mode).
//   - the WS connect-and-route effect (slides + transcripts + outline
//     onMessage handlers + idempotent close-on-cleanup).
//   - the curating watchdog (force-clears the spinner after 120 s if
//     no completion signal arrived).
//   - hydrateFromLogin (replaces the inline session-apply block on
//     LoginScreen.onSuccess).
//   - onTriggerCurate (manual curate button — POST /v1/session/curate).
//
// Phase 3a leaky abstraction: applyEvent still lives in App.tsx and
// mutates session state via the setters exposed here. Phase 3b moves
// applyEvent into the hook and the raw setters drop from the public
// return.
//
// Does NOT own (yet):
//   - applyEvent + the two transport listeners (SP_BROADCAST,
//     window.postMessage from sh-frame). Phase 3b.
//   - pendingAutoDownloadRef — used only inside applyEvent, follows
//     it into Phase 3b.
//   - the /v1/auth/me-style fan-out on 401. Phase 4 wires that.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import { ApiError, callApi, connectWs } from '../api-client'
import type { LiveTranscriptItem, Outline } from '../api-client'
import type { QuotaSnapshot, SlideItem, User } from '../../shared/types'
import { CURATE_URL } from '../../shared/config'
import { getNoteLang } from '../../shared/i18n'
import { getAutoDownload, getObsidianConfig } from '../../shared/storage'
import { exportZip, pushToObsidian } from '../lib/export'

// Bounded ring buffer cap for the live-transcript surface. Each 10 s
// audio chunk now yields 3-7 sentence-bounded segments instead of 1
// entry, so 60 covers ~3-5 minutes of recent captions.
const RING_CAP = 60

export interface UseSessionArgs {
  isEmbed: boolean
  user: User | null
  parentUrl: string | null
  // App.tsx-owned ref kept in sync from the render body. applyEvent
  // reads this to decide whether a session_started broadcast for
  // the SAME sessionId should clobber an already-loaded outline
  // (the `isResume` guard), and the auto-download branch uses it
  // to read fresh title/slides/sessionId at fire-time without
  // closing over stale state.
  exportCtxRef: RefObject<{
    parentUrl: string | null
    sessionId: string | null
    title: string
    slides: SlideItem[]
  }>
  // App.tsx-owned setter for the curator-extracted title. Adopted
  // by the /v1/session GET hydrate, by hydrateFromLogin's return
  // path (App.tsx applies the returned outlineTitle), and by the
  // applyEvent('outline_updated') branch when a new curated title
  // arrives mid-session.
  setTitle: (t: string) => void
  // Locale-aware filename placeholder. Used by the /v1/session GET
  // effect to reset title before the response lands.
  titleFallback: string
  // useQuota's setters — applyEvent's quota_update / quota_exceeded
  // cases mutate quota state through these. setQuota is the wrapper
  // that internally persists sh.cachedQuota, so applyEvent no longer
  // writes storage explicitly (single source of truth).
  setQuota: Dispatch<SetStateAction<QuotaSnapshot | null>>
  setQuotaBlocked: (b: boolean) => void
  setLiveRemainingSecs: Dispatch<SetStateAction<number | null>>
}

export interface UseSessionReturn {
  sessionId: string | null
  slides: SlideItem[]
  outline: Outline | null
  outlineUpdatedAt: number | null
  transcripts: LiveTranscriptItem[]
  curating: boolean
  curateError: string | null
  isCapturing: boolean
  videoPlaying: boolean | null
  // Eager-apply session data from LoginScreen.onSuccess. Returns the
  // curated outline title so App.tsx can adopt it into setTitle.
  hydrateFromLogin: (s: {
    id: string
    slides: SlideItem[]
    outline?: Outline | null
    updated_at?: string
  }) => { outlineTitle?: string }
  onTriggerCurate: (full?: boolean) => Promise<void>
  reset: () => void
}

// Canonical session-event names. Both transports normalise their
// transport-specific names to this set so the dispatch switch only
// has to deal with one form.
type AppEventKind =
  | 'session_started'
  | 'session_ended'
  | 'outline_updated'
  | 'curate_failed'
  | 'curating'
  | 'video_state'
  | 'quota_update'
  | 'quota_exceeded'
type AppEventPayload = {
  sessionId?: string
  quota?: QuotaSnapshot
  outline?: Outline
  playing?: boolean
  reason?: string
}
const normaliseEventKind = (raw: string | undefined): AppEventKind | null => {
  switch ((raw ?? '').toLowerCase()) {
    case 'session_started':  return 'session_started'
    case 'session_ended':    return 'session_ended'
    case 'outline_updated':  return 'outline_updated'
    case 'curate_failed':    return 'curate_failed'
    case 'curating':         return 'curating'
    case 'video_state':      return 'video_state'
    case 'quota_update':     return 'quota_update'
    case 'quota_exceeded':   return 'quota_exceeded'
    default: return null
  }
}

export function useSession({
  isEmbed, user, parentUrl, exportCtxRef, setTitle, titleFallback,
  setQuota, setQuotaBlocked, setLiveRemainingSecs,
}: UseSessionArgs): UseSessionReturn {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [slides, setSlides] = useState<SlideItem[]>([])
  const [outline, setOutline] = useState<Outline | null>(null)
  const [outlineUpdatedAt, setOutlineUpdatedAt] = useState<number | null>(null)
  const [transcripts, setTranscripts] = useState<LiveTranscriptItem[]>([])
  const [curating, setCurating] = useState(false)
  const [curateError, setCurateError] = useState<string | null>(null)
  const [isCapturing, setIsCapturing] = useState(false)
  const [videoPlaying, setVideoPlaying] = useState<boolean | null>(null)

  // Arms when session_ended fires; consumed on the next
  // outline_updated to fire the auto-download zip path (gated on
  // the user's opt-in setting). Clears after one fire so a later
  // manual regenerate doesn't re-download.
  const pendingAutoDownloadRef = useRef(false)

  // Embed: load existing session for the parent page's URL. Silent
  // catch — failure here just leaves the modal in its placeholder
  // IdleSessionState. (Preserved from pre-split semantics.)
  useEffect(() => {
    if (!isEmbed || !user || !parentUrl) return
    void (async () => {
      // Reset to placeholder while we're fetching; replaced with
      // outline.title below if the GET returns a curated session.
      setTitle(titleFallback)
      try {
        const r = await callApi<{
          session: {
            id: string
            slides: SlideItem[]
            outline: Outline | null
            transcripts?: LiveTranscriptItem[]
            updated_at?: string
          } | null
        }>(
          `/v1/session?url=${encodeURIComponent(parentUrl)}`, 'GET',
        )
        if (r.session) {
          setSessionId(r.session.id)
          setSlides(r.session.slides || [])
          setOutline(r.session.outline ?? null)
          // Hydrate live captions from persisted state — capped at
          // RING_CAP so a session with thousands of segments doesn't
          // render a monstrous list. Slice from the end (latest
          // wins) to match the live-buffer cadence.
          if (r.session.transcripts && r.session.transcripts.length > 0) {
            const items = r.session.transcripts
            setTranscripts(items.length > RING_CAP ? items.slice(-RING_CAP) : items)
          } else {
            setTranscripts([])
          }
          // Carry the DB's updated_at so the indicator shows the real
          // last-edit time when an OUTLINE exists. Without this guard
          // a session that has audio captured today but no outline
          // would inherit "today" as the indicator value and the
          // first curate's first-content-arrival branch would pick
          // that stale value instead of Date.now().
          setOutlineUpdatedAt(
            r.session.outline && r.session.updated_at
              ? new Date(r.session.updated_at).getTime()
              : null,
          )
          const curatedTitle = r.session.outline?.title?.trim()
          if (curatedTitle) setTitle(curatedTitle)
        } else {
          // No existing session for this URL. Clear so the modal
          // shows the IdleSessionState placeholder.
          setSessionId(null)
          setSlides([])
          setOutline(null)
          setOutlineUpdatedAt(null)
        }
      } catch { /* ignore */ }
    })()
    // setTitle / titleFallback are deliberately excluded from the
    // dep list. setTitle is a React useState setter (stable per
    // React); titleFallback is a locale-derived string constant
    // (re-runs are only desirable when consent/user/parentUrl
    // change, not when the i18n module emits a new reference for
    // an unchanged language). Including them caused an infinite
    // fallback↔curated title flicker before the inline-arrow fix
    // on the caller side — disabling exhaustive-deps here is a
    // defence-in-depth seatbelt for that regression.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isEmbed, parentUrl])

  // Connect WS when sessionId arrives. The handle returned by
  // connectWs owns its own reconnect-with-backoff loop (see
  // api-client.ts), so this effect just opens once on mount and
  // closes on cleanup; teardown is idempotent and cancels any
  // pending reconnect timer.
  useEffect(() => {
    if (!sessionId) return
    let mounted = true
    let handle: { close(): void } | null = null
    void (async () => {
      try {
        const h = await connectWs(sessionId, {
          onSlide: (s) => setSlides((prev) => [...prev, s]),
          onTranscript: (items) => {
            setTranscripts((prev) => {
              const next = [...prev, ...items]
              return next.length > RING_CAP ? next.slice(next.length - RING_CAP) : next
            })
          },
          onOutline: (newOutline) => {
            setOutline(newOutline)
            // Stamp NOW on every WS-delivered outline — a fresh
            // curate completed server-side even if the JSON is
            // byte-identical to the previous version.
            setOutlineUpdatedAt(Date.now())
            setCurating(false)
            setCurateError(null)
          },
          onClose: () => {
            // Reconnect attempts exhausted (or clean close). The HTTP
            // fallback still delivers curate completions; only live
            // transcripts / slides will be missed until refresh.
            // eslint-disable-next-line no-console
            console.warn('[useSession] WS permanently closed — live updates suspended for this session')
          },
          onReconnect: ({ attempt, nextDelayMs }) => {
            // eslint-disable-next-line no-console
            console.info('[useSession] WS reconnecting', { attempt, nextDelayMs })
          },
        })
        // Cleanup may have already run (sessionId changed mid-
        // handshake or component unmounted); close the freshly-
        // opened socket instead of letting it linger.
        if (mounted) handle = h
        else h.close()
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[useSession] WS connect failed:', e)
      }
    })()
    return () => { mounted = false; handle?.close() }
  }, [sessionId])

  // Central state-mutation dispatcher for session events delivered
  // by EITHER transport (chrome.runtime SP_BROADCAST or window
  // postMessage from sh-frame). Pre-split this lived in App.tsx; the
  // two transport useEffects below feed it. Centralising guarantees
  // the two transports produce identical UI behavior (earlier they
  // drifted — one transport cleared curateError on outline updates
  // and the other didn't).
  const applyEvent = useCallback((kind: AppEventKind, p: AppEventPayload): void => {
    switch (kind) {
      case 'session_started': {
        if (!isEmbed || !p.sessionId) return
        // Distinguish "resume same session" vs "fresh session". When the
        // user reopens the modal on a URL they've curated before, the
        // /v1/session GET hydrate has already populated outline /
        // slides / sessionId from the DB. The first audio chunk POSTed
        // after they press play returns the SAME canonical session id
        // (backend UPSERTs on (user_id, url_hash) so the existing row
        // wins). Without this guard we'd then wipe the just-loaded
        // outline + slides — the user perceives this as "the modal
        // suddenly forgot my notes 5 s after I pressed play".
        const isResume = exportCtxRef.current?.sessionId === p.sessionId
        setSessionId(p.sessionId)
        // Live captions are per-viewing UI and always start fresh.
        setTranscripts([])
        setQuotaBlocked(false); setCurateError(null)
        setIsCapturing(true)
        if (!isResume) {
          // Brand new session — wipe DB-backed state.
          setSlides([])
          setOutline(null)
          setOutlineUpdatedAt(null)
          setCurating(false)
        }
        return
      }
      case 'session_ended':
        if (!isEmbed) return
        // Capture is over (user-stop OR natural ended). Hide the 停止
        // button but KEEP sessionId / outline / slides so the user can
        // still trigger manual re-curate or export.
        setIsCapturing(false)
        // Wipe any stale curateError carried over from a mid-session
        // failure — the fallback copy becomes a contradiction the
        // moment capture stops. If the content-script then fires
        // triggerCurate('ended') and that fails, the curate_failed
        // broadcast that follows will re-set curateError with a fresh
        // accurate reason.
        setCurateError(null)
        // Arm the auto-download flag. The next outline_updated will
        // fire exportZip if the user has opted into the setting.
        pendingAutoDownloadRef.current = true
        return
      case 'outline_updated':
        if (!isEmbed || !p.outline) return
        // Fallback path: content script forwards the curate HTTP 200
        // outline here in case the WS broadcast was lost (long
        // curator runs can outlive an idle WS connection). Idempotent
        // — overwrites with the latest outline.
        setOutline(p.outline)
        // Stamp the indicator clock to NOW: the curator just produced
        // this outline. Without this the OutlineView's content-diff
        // guard would early-return on byte-identical regenerates and
        // the timestamp would stay stuck on the hydrate value.
        setOutlineUpdatedAt(Date.now())
        // Update the export filename to match the curated lecture
        // topic. Empty / whitespace-only titles fall back to the
        // generic placeholder.
        if (p.outline.title?.trim()) setTitle(p.outline.title.trim())
        setCurating(false)
        setCurateError(null)
        // Obsidian REST API auto-sync (fire-and-forget; failures
        // land in the console rather than blocking the read flow
        // on a transient localhost network blip).
        void (async () => {
          const cfg = await getObsidianConfig()
          if (!cfg.autoSync || !cfg.apiUrl || !cfg.apiKey) return
          const cur = exportCtxRef.current
          if (!cur || !cur.parentUrl || !cur.sessionId) return
          try {
            const r = await pushToObsidian({
              sourceUrl: cur.parentUrl,
              title: cur.title,
              slides: cur.slides,
              sessionId: cur.sessionId,
            })
            // eslint-disable-next-line no-console
            console.log('[useSession] obsidian auto-sync:', r.ok ? `${r.files} files in ${r.durationMs | 0}ms` : `FAIL ${r.error}`)
          } catch (e) {
            // eslint-disable-next-line no-console
            console.warn('[useSession] obsidian auto-sync threw:', e)
          }
        })()
        // Auto-download check: if session ended and user opted in,
        // fire the zip export now that the final outline has landed.
        // The ref disarms after one fire so a manual regenerate
        // later doesn't re-download.
        if (pendingAutoDownloadRef.current) {
          pendingAutoDownloadRef.current = false
          void (async () => {
            const enabled = await getAutoDownload()
            if (!enabled) return
            const cur = exportCtxRef.current
            if (!cur || !cur.parentUrl || !cur.sessionId) return
            try {
              await exportZip({
                sourceUrl: cur.parentUrl,
                title: cur.title,
                slides: cur.slides,
                sessionId: cur.sessionId,
              })
            } catch (e) {
              // eslint-disable-next-line no-console
              console.warn('[useSession] auto-download failed:', e)
            }
          })()
        }
        return
      case 'curating':
        if (!isEmbed) return
        setCurating(true)
        setCurateError(null)
        return
      case 'curate_failed':
        if (!isEmbed) return
        setCurating(false)
        setCurateError(p.reason ?? 'unknown')
        return
      case 'video_state':
        if (!isEmbed || typeof p.playing !== 'boolean') return
        setVideoPlaying(p.playing)
        return
      case 'quota_update':
        if (!p.quota) return
        // setQuota is useQuota's wrapper — persistence to
        // sh.cachedQuota happens internally. The content script's
        // pre-flight check (handleActivate) reads that cache to
        // decide whether to call startCapture or skip it (avoids a
        // wasted 10 s audio chunk + 402 dance at 100 % quota).
        setQuota(p.quota)
        // Re-sync the live-ticking remaining counter to the backend
        // authoritative value on every chunk. Drift between the
        // counter and reality is bounded by chunk cadence (~10 s).
        setLiveRemainingSecs(p.quota.remaining_secs)
        // Refresh-out-of-blocked: if the backend reset the period
        // (1st of the month rollover) the user can be unblocked
        // mid-session.
        if (p.quota.percent_used < 100) setQuotaBlocked(false)
        return
      case 'quota_exceeded':
        if (!p.quota) return
        setQuota(p.quota)
        setLiveRemainingSecs(p.quota.remaining_secs)
        setQuotaBlocked(true)
        return
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEmbed, exportCtxRef, setTitle, setQuota, setQuotaBlocked, setLiveRemainingSecs])

  // Transport 1: SP_BROADCAST via the SW. Reaches embed AND
  // side-panel contexts. Server-format event names (snake_case).
  useEffect(() => {
    const listener = (msg: { type: string; payload?: { type: string } & AppEventPayload }) => {
      if (msg.type !== 'SP_BROADCAST' || !msg.payload) return
      const kind = normaliseEventKind(msg.payload.type)
      if (kind) applyEvent(kind, msg.payload)
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [applyEvent])

  // Transport 2: window.postMessage from the content frame inside
  // the embed iframe (top-frame postMessage relay → modal iframe).
  // Uses SCREAMING_SNAKE event names; normaliseEventKind lowercases.
  useEffect(() => {
    if (!isEmbed) return
    const listener = (e: MessageEvent) => {
      const data = e.data as ({ source?: string; type?: string } & AppEventPayload) | null
      if (!data || data.source !== 'sh-frame') return
      const kind = normaliseEventKind(data.type)
      if (kind) applyEvent(kind, data)
    }
    window.addEventListener('message', listener)
    return () => window.removeEventListener('message', listener)
  }, [isEmbed, applyEvent])

  // Curating watchdog. Defensive against ANY curate path (manual
  // modal click, content-script auto-trigger on session-end, future
  // trigger types) leaving the modal stuck in "ノート生成中…" when the
  // success / failure signal got lost. Curator's own Lambda timeout
  // is 5 min; we wait a touch longer (120 s) on the assumption that
  // any well-behaved request will have signalled by then. Force-
  // clear with an error message and let the user retry.
  useEffect(() => {
    if (!curating) return
    const id = window.setTimeout(() => {
      setCurating(false)
      setCurateError('timeout_no_signal')
      // eslint-disable-next-line no-console
      console.warn('[useSession] curating watchdog fired — no outline signal received in 120 s')
    }, 120_000)
    return () => window.clearTimeout(id)
  }, [curating])

  const hydrateFromLogin = useCallback((s: {
    id: string
    slides: SlideItem[]
    outline?: Outline | null
    updated_at?: string
  }): { outlineTitle?: string } => {
    setSessionId(s.id)
    setSlides(s.slides ?? [])
    const o = s.outline ?? null
    setOutline(o)
    setOutlineUpdatedAt(
      o && s.updated_at ? new Date(s.updated_at).getTime() : null,
    )
    return { outlineTitle: o?.title?.trim() || undefined }
  }, [])

  const onTriggerCurate = useCallback(async (full = false) => {
    if (!sessionId) return
    setCurating(true)
    try {
      const noteLang = getNoteLang()
      const r = await callApi<{ outline: Outline | null; reason?: string }>(
        '/v1/session/curate', 'POST',
        { session_id: sessionId, full_rewrite: full, note_language: noteLang },
        { absoluteUrl: CURATE_URL || undefined },
      )
      if (r.outline) {
        setOutline(r.outline)
        // The HTTP response IS the curate-completion signal; stamp
        // the indicator clock to NOW (same reasoning as the WS /
        // postMessage outline_updated paths).
        setOutlineUpdatedAt(Date.now())
        setCurating(false)
        setCurateError(null)
      } else {
        // Server explicitly said "nothing to curate" or returned an
        // empty body. Clear the spinner with a user-facing reason —
        // hanging on `curating: true` is the bug we're fixing.
        setCurating(false)
        setCurateError(r.reason ?? 'no_outline_returned')
      }
    } catch (e) {
      setCurating(false)
      // ApiError preserves the parsed response body so the 409
      // `{error: 'curate_in_progress'}` and 502
      // `{error: 'curator_failed'}` shapes surface as localised
      // reasons. Mirrors content/index.ts's priority order:
      //   data.reason  (200 soft-fail key)  ―
      //   data.error   (4xx / 5xx error key) ―
      //   error string (SW wrapper) — last resort.
      let reason = 'unknown'
      if (e instanceof ApiError) {
        const data = e.data as { reason?: string; error?: string } | undefined
        reason = data?.reason ?? data?.error ?? e.message ?? 'unknown'
      } else if (e instanceof Error) {
        reason = e.message
      }
      setCurateError(reason)
    }
  }, [sessionId])

  const reset = useCallback(() => {
    setSessionId(null)
    setSlides([])
    setOutline(null)
    setOutlineUpdatedAt(null)
    setTranscripts([])
    setCurating(false)
    setCurateError(null)
    setIsCapturing(false)
    setVideoPlaying(null)
    // Disarm any pending auto-download flag so the next user's
    // first outline_updated doesn't fire a stale zip export under
    // the new account's auth.
    pendingAutoDownloadRef.current = false
  }, [])

  return {
    sessionId, slides, outline, outlineUpdatedAt, transcripts,
    curating, curateError, isCapturing, videoPlaying,
    hydrateFromLogin, onTriggerCurate, reset,
  }
}
