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
import { useCallback, useEffect, useState } from 'react'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import { ApiError, callApi, connectWs } from '../api-client'
import type { LiveTranscriptItem, Outline } from '../api-client'
import type { SlideItem, User } from '../../shared/types'
import { CURATE_URL } from '../../shared/config'
import { getNoteLang } from '../../shared/i18n'

// Bounded ring buffer cap for the live-transcript surface. Each 10 s
// audio chunk now yields 3-7 sentence-bounded segments instead of 1
// entry, so 60 covers ~3-5 minutes of recent captions.
const RING_CAP = 60

export interface UseSessionArgs {
  isEmbed: boolean
  user: User | null
  parentUrl: string | null
  // App.tsx-owned ref kept in sync from the render body. applyEvent
  // (still in App.tsx during Phase 3a) reads this to decide whether
  // a session_started broadcast for the SAME sessionId should clobber
  // an already-loaded outline (`isResume` guard).
  exportCtxRef: RefObject<{
    parentUrl: string | null
    sessionId: string | null
    title: string
    slides: SlideItem[]
  }>
  // App.tsx-owned setter for the curator-extracted title. /v1/session
  // GET adopts the title when an outline exists; LoginScreen onSuccess
  // does the same via hydrateFromLogin's return value (App.tsx applies
  // the returned outlineTitle).
  setTitle: (t: string) => void
  // Locale-aware filename placeholder. Hooked in by App.tsx (which
  // owns the useT() instance for the rendering tree). Used by the
  // /v1/session GET effect to reset title before the response lands.
  titleFallback: string
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
  // Leaky abstraction during Phase 3a — applyEvent still lives in
  // App.tsx and mutates these via the destructured setters. Phase 3b
  // removes them from the return surface.
  setSessionId: (s: string | null) => void
  setSlides: Dispatch<SetStateAction<SlideItem[]>>
  setOutline: (o: Outline | null) => void
  setOutlineUpdatedAt: (n: number | null) => void
  setTranscripts: Dispatch<SetStateAction<LiveTranscriptItem[]>>
  setCurating: (b: boolean) => void
  setCurateError: (s: string | null) => void
  setIsCapturing: (b: boolean) => void
  setVideoPlaying: (b: boolean | null) => void
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

export function useSession({
  isEmbed, user, parentUrl, exportCtxRef, setTitle, titleFallback,
}: UseSessionArgs): UseSessionReturn {
  // exportCtxRef is referenced via .current inside applyEvent (still
  // in App.tsx during 3a), so the arg is accepted but not consumed
  // by the hook body itself in Phase 3a — present for forward-
  // compatibility with Phase 3b.
  void exportCtxRef

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [slides, setSlides] = useState<SlideItem[]>([])
  const [outline, setOutline] = useState<Outline | null>(null)
  const [outlineUpdatedAt, setOutlineUpdatedAt] = useState<number | null>(null)
  const [transcripts, setTranscripts] = useState<LiveTranscriptItem[]>([])
  const [curating, setCurating] = useState(false)
  const [curateError, setCurateError] = useState<string | null>(null)
  const [isCapturing, setIsCapturing] = useState(false)
  const [videoPlaying, setVideoPlaying] = useState<boolean | null>(null)

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
  }, [user, isEmbed, parentUrl, setTitle, titleFallback])

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
  }, [])

  return {
    sessionId, slides, outline, outlineUpdatedAt, transcripts,
    curating, curateError, isCapturing, videoPlaying,
    setSessionId, setSlides, setOutline, setOutlineUpdatedAt, setTranscripts,
    setCurating, setCurateError, setIsCapturing, setVideoPlaying,
    hydrateFromLogin, onTriggerCurate, reset,
  }
}
