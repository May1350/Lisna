import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import type { SlideItem, User, QuotaSnapshot } from '../shared/types'
import { hasConsent, setConsent, getEnabled, onEnabledChange, getAutoDownload, getObsidianConfig } from '../shared/storage'
import { CURATE_URL } from '../shared/config'
import { exportZip, pushToObsidian } from './lib/export'
import { ConsentModal } from './components/ConsentModal'
import { LoginScreen } from './components/LoginScreen'
import { OutlineView } from './components/OutlineView'
import { SessionHistory, type SessionSummary } from './components/SessionHistory'
import { NotesViewer } from './components/NotesViewer'
import { LiveTranscript } from './components/LiveTranscript'
import { ExportMenu } from './components/ExportMenu'
import { QuotaBanner } from './components/QuotaBanner'
import { PanelHeader } from './components/PanelHeader'
import { SessionControls } from './components/SessionControls'
import { QuotaExhaustedIdle } from './components/QuotaExhaustedIdle'
import { callApi, connectWs, getCurrentUser, logout, ApiError } from './api-client'
import type { LiveTranscriptItem, Outline } from './api-client'
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
        <span className="absolute inset-0 rounded-full border-4 border-blue-100" />
        <span className="absolute inset-0 rounded-full border-4 border-blue-500 border-t-transparent animate-spin" />
      </div>
      <p className="text-sm font-medium text-gray-900">{T.curate.spinnerTitle}</p>
      <p className="text-xs text-gray-500 mt-1 max-w-xs leading-relaxed">
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
  if (videoPlaying === false) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-10 text-center text-gray-700">
        <div className="text-3xl mb-3">⏸</div>
        <p className="text-sm font-medium">{T.capture.pausedTitle}</p>
        <p className="text-xs text-gray-500 mt-1 max-w-xs leading-relaxed">
          {T.capture.pausedHint}
        </p>
      </div>
    )
  }
  if (videoPlaying === true) {
    // recordingHint may contain a literal "\n" — render with <br/>.
    const lines = T.capture.recordingHint.split('\n')
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-10 text-center text-gray-700">
        <div className="text-3xl mb-3">🎙️</div>
        <p className="text-sm font-medium">{T.capture.recordingTitle}</p>
        <p className="text-xs text-gray-500 mt-1 max-w-xs leading-relaxed">
          {lines.map((line, i) => (
            <span key={i}>
              {line}
              {i < lines.length - 1 && <br />}
            </span>
          ))}
        </p>
      </div>
    )
  }
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-10 text-center text-gray-500">
      <div className="text-3xl mb-3">⏳</div>
      <p className="text-sm">{T.capture.waiting}</p>
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
        <span className="text-gray-500 shrink-0">{T.export.fileName}</span>
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
          className="flex-1 min-w-0 px-2 py-1 border border-blue-400 rounded text-xs focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-200"
        />
      </div>
    )
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="w-full flex items-center gap-1.5 text-xs text-left hover:bg-gray-100 rounded px-1 py-1 transition group"
      title={T.export.fileNameTooltip}
    >
      <span className="text-gray-500 shrink-0">{T.export.fileName}</span>
      <span className="flex-1 min-w-0 truncate text-gray-900 font-medium">{title}</span>
      <span className="opacity-0 group-hover:opacity-100 text-gray-400 transition">✎</span>
    </button>
  )
}

export default function App() {
  const T = useT()
  const [consented, setConsented] = useState<boolean | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  // Curated, hierarchical outline produced by the backend curator. Replaced
  // wholesale on every curator run (every ~30 s of lecture); the UI thus
  // evolves as the lecture progresses.
  const [outline, setOutline] = useState<Outline | null>(null)
  // Server-trusted last-update epoch ms for the hydrated outline. Set
  // from sessions.updated_at on initial hydrate (login eager-load or
  // GET /v1/session) so the modal's "X分前" indicator reflects the
  // actual save time of an existing note rather than the modal-open
  // time. Stays at this value across the lifetime of the OutlineView
  // instance — real-time WS / curate updates use Date.now() inside
  // OutlineView itself (see serverUpdatedAt prop semantics there).
  // null means "no DB record / hydrating" — OutlineView falls through
  // to Date.now() for the first content arrival in that case.
  const [outlineUpdatedAt, setOutlineUpdatedAt] = useState<number | null>(null)
  const [slides, setSlides] = useState<SlideItem[]>([])
  // Live transcript items (streamed from /v1/stream/audio's STT step before
  // LLM finishes). Bounded ring buffer — we only keep the last ~30 chunks
  // (≈5 min at 10 s chunks) so the UI stays responsive on long sessions.
  const [transcripts, setTranscripts] = useState<LiveTranscriptItem[]>([])
  // Phase 6.1: curating state. Goes true when content-script POSTs
  // /v1/session/curate (pause / ended / manual button) and back to false
  // when the outline_updated WS message arrives. UI shows a spinner row.
  const [curating, setCurating] = useState(false)
  // Latest quota snapshot. Updated on every chunk response from
  // /v1/stream/audio (forwarded by content script). Drives the tiered
  // QuotaBanner: <50% silent, 50-79% subtle, 80-94% amber, 95-99% orange,
  // 100% blocking. `quotaBlocked` flips true on a 402 response and turns
  // the banner red even if the snapshot itself isn't yet at 100% (race
  // window where the period rolled before the next chunk).
  const [quota, setQuota] = useState<QuotaSnapshot | null>(null)
  const [quotaBlocked, setQuotaBlocked] = useState(false)
  // Video play/pause state, broadcast from the content script. Drives
  // the placeholder copy in LiveTranscript while we wait for the first
  // chunk: playing → "🎙️ 음성 처리 중…" / paused → "⏸ 강의를 재생하세요".
  const [videoPlaying, setVideoPlaying] = useState<boolean | null>(null)
  // Surfaces a non-blocking error message under the spinner when the
  // curator fails (502 / network / no transcripts yet). Cleared when the
  // next outline_updated arrives.
  const [curateError, setCurateError] = useState<string | null>(null)
  // When the video ends (content script broadcasts session_ended) we
  // arm a flag that fires the auto-download zip path on the very next
  // outline_updated — provided the user has opted into the setting in
  // the Options page. The flag clears after one fire so a subsequent
  // outline update (e.g. the user manually clicks regenerate) doesn't
  // re-trigger the download.
  const pendingAutoDownloadRef = useRef(false)
  // True while the content script is actively capturing audio/slides.
  // Goes true on session_started and false on session_ended (user-stop
  // OR natural <video> end). Decoupled from `sessionId` so the modal
  // can keep the outline / ExportMenu / manual curate UI alive after
  // capture stops — the user explicitly asked: "stopping should still
  // leave note generation possible."
  const [isCapturing, setIsCapturing] = useState(false)
  // Locally-ticked remaining-seconds counter for the modal header. The
  // backend's quota_update events arrive once per ~10 s audio chunk;
  // between updates the user is still consuming their free minutes.
  // We re-sync this value to the backend's authoritative number on
  // every quota_update, then decrement 1/sec while actively capturing
  // + video is playing — gives a smooth real-time visualisation that
  // the user can plan around (notice "1分しか残ってない" mid-lecture
  // and decide to upgrade BEFORE hitting the blocking 100% wall).
  const [liveRemainingSecs, setLiveRemainingSecs] = useState<number | null>(null)
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

  useEffect(() => { void hasConsent().then(setConsented) }, [])
  // Wait until the user has explicitly consented before fetching the
  // session. Earlier deps `[consented]` made this re-run on every
  // consented flip — including the initial null→false on a fresh
  // user — issuing a needless AUTH_GET_USER round-trip and clobbering
  // any in-flight setUser the login flow had just performed.
  useEffect(() => {
    if (consented !== true) return
    void getCurrentUser().then(setUser)
    // Seed the quota state from /v1/auth/me on mount. Without this the
    // modal had no idea about the user's quota until the FIRST audio
    // chunk's response landed (~12 s into a session) — meaning the
    // QuotaExhaustedIdle / SessionControls quota mode couldn't render
    // for users who were already at 100% before they even pressed
    // play. Failure is silent: quota stays null and the regular idle
    // copy renders, which is the pre-fix behavior.
    void callApi<{ user: User; quota: QuotaSnapshot }>('/v1/auth/me', 'GET')
      .then(r => {
        if (r.quota) {
          setQuota(r.quota)
          // Mirror to chrome.storage for the content script's
          // pre-flight check (handleActivate skips startCapture when
          // cached percent_used >= 100).
          void chrome.storage.local.set({ 'sh.cachedQuota': { quota: r.quota, ts: Date.now() } })
        }
      })
      .catch(() => { /* ignore — quota stays null, regular flow */ })
  }, [consented])

  // Keep the export-input ref in sync with the React state used by
  // the auto-download path inside applyEvent. Refs are commit-phase
  // safe to write from the render body — no useEffect needed.
  exportCtxRef.current = { parentUrl, sessionId, title, slides }

  // ON/OFF state — only meaningful in the side-panel (account) view, but we
  // load + subscribe regardless so the source of truth is storage.
  useEffect(() => {
    void getEnabled().then(setEnabledState)
    const off = onEnabledChange(setEnabledState)
    return off
  }, [])

  // Initial playback speed from storage. Shared key with the options page.
  useEffect(() => {
    void chrome.storage.local.get('sh.playback').then(r => {
      const stored = r['sh.playback']
      if (typeof stored === 'number') setPlaybackSpeed(stored)
      else if (stored === 'auto' || stored === undefined) setPlaybackSpeed(2)
    })
  }, [])

  // Listen for SP_BROADCAST from content via SW. The embed (in-page modal)
  // and the side-panel (account view) both subscribe — quota updates are
  // useful in both contexts, while session_started is embed-only.
  //
  // Two transports flow into the same set of state mutations:
  //   - SP_BROADCAST messages from the SW (content script → SW → here)
  //     use snake_case event names ('session_started', 'quota_update',
  //     'outline_updated', 'curate_failed', 'video_state').
  //   - window.postMessage from the in-page content frame uses
  //     SCREAMING_SNAKE ('CURATING', 'OUTLINE_UPDATED', 'CURATE_FAILED',
  //     'VIDEO_STATE', 'QUOTA_UPDATE', 'QUOTA_EXCEEDED').
  // The two name lists were maintained separately in earlier versions,
  // which led to drift (e.g. one transport cleared `curateError` on
  // outline updates and the other didn't). `applyEvent` centralises the
  // state-mutation logic so the two transports are guaranteed to
  // produce identical UI behavior.
  type AppEventPayload = {
    sessionId?: string
    quota?: QuotaSnapshot
    outline?: Outline
    playing?: boolean
    reason?: string
  }
  type AppEventKind =
    | 'session_started'
    | 'session_ended'
    | 'outline_updated'
    | 'curate_failed'
    | 'curating'
    | 'video_state'
    | 'quota_update'
    | 'quota_exceeded'
  // Single normalisation point. Both transports lower-case the event
  // name so the switch deals with one canonical form.
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
  const applyEvent = useCallback((kind: AppEventKind, p: AppEventPayload): void => {
    switch (kind) {
      case 'session_started': {
        if (!isEmbed || !p.sessionId) return
        // Distinguish "resume same session" vs "fresh session". When the
        // user reopens the modal on a URL they've curated before, the
        // useEffect that GETs /v1/session has already populated outline /
        // slides / sessionId from the DB. The first audio chunk POSTed
        // after they press play returns the SAME canonical session id
        // (backend UPSERTs on (user_id, url_hash) so the existing row
        // wins). Without this guard we'd then wipe the just-loaded
        // outline + slides — the user perceives this as "the modal
        // suddenly forgot my notes 5 s after I pressed play".
        const isResume = exportCtxRef.current.sessionId === p.sessionId
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
        // failure. The fallback copy ("녹음은 계속되고 있어요" /
        // "Recording continues") becomes a contradiction the moment
        // capture stops, since the post-session UI also shows the
        // green "녹음이 종료되었습니다" hint right beneath. If
        // content-script fires triggerCurate('ended') here and that
        // call fails, the curate_failed broadcast that follows will
        // re-set curateError with a fresh, accurate reason — this
        // clear runs synchronously before any async response arrives.
        setCurateError(null)
        // Arm the auto-download flag. The next outline_updated will
        // fire exportZip if the user has opted into the setting.
        pendingAutoDownloadRef.current = true
        return
      case 'outline_updated':
        if (!isEmbed || !p.outline) return
        // Fallback path: content script forwards the curate HTTP 200
        // outline here in case the WS broadcast was lost (long curator
        // runs can outlive an idle WS connection). Idempotent —
        // overwrites with the latest outline.
        setOutline(p.outline)
        // Stamp the indicator clock to NOW: the curator just produced
        // this outline, regardless of whether the JSON happened to
        // match a previous version (e.g. user clicked regenerate
        // without new content). Without this the OutlineView's
        // content-diff guard would early-return and the timestamp
        // would stay stuck on the hydrate value (3시간 전 etc).
        setOutlineUpdatedAt(Date.now())
        // Update the export filename to match the curated lecture
        // topic. Empty / whitespace-only titles fall back to the
        // generic placeholder — better than naming a file ".zip".
        if (p.outline.title?.trim()) setTitle(p.outline.title.trim())
        setCurating(false)
        setCurateError(null)
        // v0.3 auto-sync: when the user has enabled Obsidian REST API
        // sync, push the freshly-curated lecture to their vault now.
        // Fire-and-forget; failures land in the console rather than
        // blocking the modal so a transient network blip on localhost
        // doesn't disrupt the read flow.
        void (async () => {
          const cfg = await getObsidianConfig()
          if (!cfg.autoSync || !cfg.apiUrl || !cfg.apiKey) return
          const cur = exportCtxRef.current
          if (!cur.parentUrl || !cur.sessionId) return
          try {
            const r = await pushToObsidian({
              sourceUrl: cur.parentUrl,
              title: cur.title,
              slides: cur.slides,
              sessionId: cur.sessionId,
            })
            // eslint-disable-next-line no-console
            console.log('[App] obsidian auto-sync:', r.ok ? `${r.files} files in ${r.durationMs|0}ms` : `FAIL ${r.error}`)
          } catch (e) {
            // eslint-disable-next-line no-console
            console.warn('[App] obsidian auto-sync threw:', e)
          }
        })()
        // Auto-download check: if session ended and user opted in,
        // fire the zip export now that the final outline has landed.
        // Guarded by the ref so a manually-triggered regenerate later
        // doesn't re-download.
        if (pendingAutoDownloadRef.current) {
          pendingAutoDownloadRef.current = false
          void (async () => {
            const enabled = await getAutoDownload()
            if (!enabled) return
            // Read fresh state from the ref so we don't fire on stale
            // closure values from the moment applyEvent was created.
            const cur = exportCtxRef.current
            if (!cur.parentUrl || !cur.sessionId) return
            try {
              await exportZip({
                sourceUrl: cur.parentUrl,
                title: cur.title,
                slides: cur.slides,
                sessionId: cur.sessionId,
              })
            } catch (e) {
              // eslint-disable-next-line no-console
              console.warn('[App] auto-download failed:', e)
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
        setQuota(p.quota)
        // Cache for the content script's pre-flight check. handleActivate
        // reads this synchronously from chrome.storage to decide whether
        // to call startCapture or skip it (saves a wasted 10 s audio
        // chunk and 402 dance every time the user clicks the inline
        // button at quota = 100%).
        void chrome.storage.local.set({ 'sh.cachedQuota': { quota: p.quota, ts: Date.now() } })
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
        void chrome.storage.local.set({ 'sh.cachedQuota': { quota: p.quota, ts: Date.now() } })
        setLiveRemainingSecs(p.quota.remaining_secs)
        setQuotaBlocked(true)
        return
    }
  }, [isEmbed])

  // Transport 1: SP_BROADCAST via the SW. Reaches embed AND side-panel
  // contexts. Server-format event names (snake_case).
  useEffect(() => {
    const listener = (msg: { type: string; payload?: { type: string } & AppEventPayload }) => {
      if (msg.type !== 'SP_BROADCAST' || !msg.payload) return
      const kind = normaliseEventKind(msg.payload.type)
      if (kind) applyEvent(kind, msg.payload)
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
    // applyEvent is stable per isEmbed; normaliseEventKind is local.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyEvent])

  // Transport 2: window.postMessage from the content frame inside the
  // embed iframe (top-frame postMessage relay → modal iframe). Uses
  // SCREAMING_SNAKE event names; normaliseEventKind lowercases them.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEmbed, applyEvent])

  // Embed: load the existing session (if any) for the parent page's URL.
  useEffect(() => {
    if (!isEmbed || !user || !parentUrl) return
    void (async () => {
      // Reset to placeholder while we're fetching; replaced with
      // outline.title below if the GET returns a curated session.
      setTitle(TITLE_FALLBACK)
      try {
        // Backend's /v1/session response still includes a legacy `notes`
        // array (per-chunk bullets from before Phase 6.1). The modal
        // renders only `outline` now, so we ignore that field. See
        // backend/src/handlers/session-get.ts for the full shape.
        const r = await callApi<{
          session: {
            id: string
            slides: SlideItem[]
            outline: Outline | null
            // Persisted live captions. Optional in the type so older
            // backends (pre-Phase 7) and brand-new sessions without
            // any audio yet are tolerated without a runtime guard.
            transcripts?: LiveTranscriptItem[]
            updated_at?: string
          } | null
        }>(
          `/v1/session?url=${encodeURIComponent(parentUrl)}`, 'GET'
        )
        if (r.session) {
          setSessionId(r.session.id)
          setSlides(r.session.slides || [])
          setOutline(r.session.outline ?? null)
          // Hydrate the LiveTranscript surface from the persisted
          // backend state. Without this, closing the modal mid-lecture
          // and reopening it (or page-reloading) wiped every caption
          // the user had been reading even though the data was safe in
          // the DB. Cap to the same RING_CAP the WS path uses (60) so
          // sessions with thousands of segments don't render a
          // monstrous list — older items fall off the front, mirroring
          // the live behaviour. We slice from the end (latest items
          // win) to match what the user would have seen had they
          // stayed in the modal.
          if (r.session.transcripts && r.session.transcripts.length > 0) {
            const RING_CAP = 60
            const items = r.session.transcripts
            setTranscripts(items.length > RING_CAP ? items.slice(-RING_CAP) : items)
          } else {
            setTranscripts([])
          }
          // Carry the DB's updated_at so the indicator shows the real
          // last-edit time of this saved note instead of "now". Only
          // use the server timestamp when an OUTLINE actually exists
          // — sessions.updated_at also moves on every audio chunk
          // write, so without this guard a session that has audio
          // captured today but no outline yet would inherit "today"
          // as the indicator value, then on the user's first curate
          // the OutlineView's first-content-arrival branch would
          // pick that stale value instead of Date.now(). Net effect
          // was a freshly-curated note showing "3시간 전".
          setOutlineUpdatedAt(
            r.session.outline && r.session.updated_at
              ? new Date(r.session.updated_at).getTime()
              : null,
          )
          // Adopt the curator-extracted title for the filename. Falls
          // through to the placeholder when the curator hasn't run
          // yet (outline === null) or returned an empty string.
          const curatedTitle = r.session.outline?.title?.trim()
          if (curatedTitle) setTitle(curatedTitle)
        } else {
          // No existing session for this URL. Without this clear, the
          // UI would render stale outline / slides / sessionId from a
          // previously-loaded lecture, then 404 when the user clicks
          // export (because the BACKEND has no outline for the new
          // url_hash). Clear everything so the modal correctly shows
          // the IdleSessionState placeholder.
          setSessionId(null)
          setSlides([])
          setOutline(null)
          setOutlineUpdatedAt(null)
        }
      } catch { /* ignore */ }
    })()
  }, [user, isEmbed, parentUrl])

  // connect WS when sessionId arrives (embed only). The handle returned
  // by connectWs owns its own reconnect-with-backoff loop (see
  // api-client.ts), so this effect just opens once on mount and closes
  // on cleanup; teardown is idempotent and cancels any pending
  // reconnect timer.
  useEffect(() => {
    if (!sessionId) return
    let mounted = true
    let handle: { close(): void } | null = null
    void (async () => {
      try {
        const h = await connectWs(sessionId, {
          onSlide: (s) => setSlides(prev => [...prev, s]),
          onTranscript: (items) => {
            // Bounded ring buffer — drop the oldest when we exceed the cap.
            // Cap is 60 (vs the older 30) because each 10 s audio chunk now
            // yields 3-7 sentence-bounded segments instead of 1 entry, so
            // the visible time window per item is shorter. 60 covers ~3-5
            // minutes of recent captions, which matches the old footprint
            // while preserving the new sub-chunk granularity.
            const RING_CAP = 60
            setTranscripts(prev => {
              const next = [...prev, ...items]
              return next.length > RING_CAP ? next.slice(next.length - RING_CAP) : next
            })
          },
          onOutline: (newOutline) => {
            setOutline(newOutline)
            // Stamp NOW on every WS-delivered outline — same reasoning
            // as the postMessage outline_updated path: a fresh curate
            // completed server-side, even if the JSON is byte-
            // identical to the previous version.
            setOutlineUpdatedAt(Date.now())
            setCurating(false)
            setCurateError(null)
          },
          onClose: () => {
            // Reconnection attempts have been exhausted (or the close
            // was clean). The HTTP fallback in content/index.ts still
            // delivers curate completions over chrome.runtime, so the
            // user can keep generating notes; only live transcripts /
            // slides from this session id will be missed until they
            // refresh the modal.
            // eslint-disable-next-line no-console
            console.warn('[App] WS permanently closed — live updates suspended for this session')
          },
          onReconnect: ({ attempt, nextDelayMs }) => {
            // Diagnostic only for now. A future iteration could surface
            // a "live updates paused — reconnecting" badge in the
            // header; for now the user gets through via HTTP fallback
            // and the issue is silent.
            // eslint-disable-next-line no-console
            console.info('[App] WS reconnecting', { attempt, nextDelayMs })
          },
        })
        // If the cleanup already ran (sessionId changed mid-handshake or
        // the component unmounted), close the freshly-opened socket
        // instead of letting it linger.
        if (mounted) handle = h
        else h.close()
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[App] WS connect failed:', e)
      }
    })()
    return () => { mounted = false; handle?.close() }
  }, [sessionId])

  // 1 Hz tick-down for the live remaining-secs display. Only ticks
  // while the user is ACTIVELY consuming their quota (capturing AND
  // video playing) — pause/scrub/non-capturing states freeze the
  // counter where it is. The next chunk's quota_update will resync
  // to the backend's authoritative value, so any tiny drift is
  // bounded by the ~10 s chunk cadence.
  //
  // Deps are [isCapturing, videoPlaying] only — we do NOT list
  // liveRemainingSecs even though we read it. Listing it would tear
  // down + rebuild the interval every second (since the state
  // updates every tick), which is wasteful and races: the new
  // setInterval starts ~0 ms after the previous tick fired, so the
  // wall-clock cadence drifts. Instead we read the current value
  // through the functional setter form, where `prev` is always the
  // freshest state regardless of when the closure was created.
  useEffect(() => {
    if (!isCapturing || videoPlaying !== true) return
    const id = window.setInterval(() => {
      setLiveRemainingSecs(prev => {
        if (prev === null) return prev
        return prev > 0 ? prev - 1 : 0
      })
    }, 1000)
    return () => window.clearInterval(id)
  }, [isCapturing, videoPlaying])

  // Watchdog for the `curating` flag. Defensive against ANY curate path
  // (manual modal click, content-script auto-trigger on session-end,
  // future trigger types) leaving the modal stuck in "ノート生成中…"
  // when the success / failure signal got lost (WS dropped, postMessage
  // never arrived, SW restart mid-flight). The curator's own Lambda
  // timeout is 5 min; we wait a touch longer (120 s) on the assumption
  // that any well-behaved request will have signalled by then. If we
  // fall through, force-clear with an error message and let the user
  // retry — better than infinite spinner.
  useEffect(() => {
    if (!curating) return
    const id = window.setTimeout(() => {
      setCurating(false)
      setCurateError('timeout_no_signal')
      // eslint-disable-next-line no-console
      console.warn('[App] curating watchdog fired — no outline signal received in 120 s')
    }, 120_000)
    return () => window.clearTimeout(id)
  }, [curating])

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

  const onClose = useCallback(() => {
    if (isEmbed) {
      window.parent.postMessage({ type: 'SH_CLOSE_MODAL' }, '*')
    } else {
      window.close()
    }
  }, [isEmbed])

  const onLogout = useCallback(async () => {
    await logout()
    // Reset every piece of session-derived state. Missing any of these
    // (we previously missed outline / transcripts / quota / curating /
    // curateError) leaves stale UI when the user logs in as a different
    // account — the new account would briefly see the old user's
    // outline before WS / quota updates overwrite it.
    setUser(null)
    setSessionId(null)
    setSlides([])
    setOutline(null)
    setOutlineUpdatedAt(null)
    setTranscripts([])
    setCurating(false)
    setCurateError(null)
    setQuota(null)
    setQuotaBlocked(false)
    setVideoPlaying(null)
    setIsCapturing(false)
  }, [])

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
            // setUser triggers the useEffect that loads existing session via
            // GET /v1/session as a fallback path. But the backend just gave
            // us that session in the same response — apply it eagerly so the
            // user sees the outline the moment they land on the session view.
            setUser(result.user)
            if (result.currentSession) {
              setSessionId(result.currentSession.id)
              setSlides(result.currentSession.slides ?? [])
              const o = result.currentSession.outline ?? null
              setOutline(o)
              setOutlineUpdatedAt(
                o && result.currentSession.updated_at
                  ? new Date(result.currentSession.updated_at).getTime()
                  : null,
              )
              if (o?.title?.trim()) setTitle(o.title.trim())
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
    // Manual curate trigger. Calls /v1/session/curate DIRECTLY from
    // the modal instead of postMessage'ing the content script.
    //
    // Apply the HTTP response synchronously instead of waiting on the
    // WS outline_updated broadcast. The WS connection can drop during
    // the 30-90 s curator wall (idle WS connections in API Gateway are
    // reaped, and sites like K-LMS rearrange iframes mid-watch). When
    // the broadcast was the only success signal, the modal hung in
    // "ノート生成中…" forever even though the curator had succeeded
    // and persisted the outline — confirmed by the user reporting
    // they had to refresh to see notes that were already in the DB.
    //
    // Applying the HTTP response is the SOURCE-OF-TRUTH path:
    // /v1/session/curate returns 200 with the outline body whether or
    // not WS delivery succeeded. The WS / SP_BROADCAST handlers are
    // idempotent (applyEvent('outline_updated') replaces state with
    // whatever it received), so duplicate delivery is safe.
    const onTriggerCurate = async (full = false) => {
      if (!sessionId) return
      setCurating(true)
      try {
        // Pass the user's note language preference to the backend.
        // 'auto' means "let the curator detect from transcript"; the
        // four ISO codes force the prose into that language.
        const noteLang = (await import('../shared/i18n')).getNoteLang()
        const r = await callApi<{ outline: Outline | null; reason?: string }>(
          '/v1/session/curate', 'POST',
          { session_id: sessionId, full_rewrite: full, note_language: noteLang },
          { absoluteUrl: CURATE_URL || undefined },
        )
        if (r.outline) {
          setOutline(r.outline)
          // The HTTP response IS the curate-completion signal; stamp
          // the indicator clock to NOW. (Same reasoning as the WS /
          // postMessage outline_updated paths.)
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
        // reasons instead of the raw "HTTP 409: ..." string falling
        // through to the generic fallback copy. Mirrors the same
        // priority order used in content/index.ts:
        //   data.reason  (200 soft-fail key)  ―
        //   data.error   (4xx / 5xx error key) ―
        //   error string (SW wrapper) — last resort
        let reason = 'unknown'
        if (e instanceof ApiError) {
          const data = e.data as { reason?: string; error?: string } | undefined
          reason = data?.reason ?? data?.error ?? e.message ?? 'unknown'
        } else if (e instanceof Error) {
          reason = e.message
        }
        setCurateError(reason)
      }
    }
    const hasContent = !!outline?.sections.length
    const hasTranscripts = transcripts.length > 0
    return (
      <div className="min-h-screen flex flex-col bg-gray-50">
        <PanelHeader
          user={user}
          isEmbed
          playbackSpeed={playbackSpeed}
          onSpeedChange={onSpeedChange}
          onClose={onClose}
          onLogout={onLogout}
          liveRemainingSecs={liveRemainingSecs}
        />
        {/* QuotaBanner is suppressed when the QuotaExhaustedIdle card
            below would render — that card now embeds its own
            progress bar + reset note, so showing the compact banner
            above it would be a duplicate "you're at the limit"
            message stacked on the same screen. The banner stays for
            every other render path (warn 90-99%, blocked + has-content). */}
        {!(!hasContent && quota && (quota.percent_used >= 100 || quotaBlocked)) && (
          <QuotaBanner user={user} quota={quota} blocked={quotaBlocked} onUpgrade={onUpgrade} />
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
          (quota && (quota.percent_used >= 100 || quotaBlocked)) ? (
            <QuotaExhaustedIdle user={user} quota={quota} onUpgrade={onUpgrade} upgrading={upgrading} />
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
          <div className="mx-3 mb-1 bg-red-50 border border-red-200 text-red-800 text-xs px-3 py-2 rounded flex items-start gap-2">
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
                className="shrink-0 text-[11px] font-medium text-red-700 hover:text-red-900 underline whitespace-nowrap"
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
            const exhausted = !!quota && (quota.percent_used >= 100 || quotaBlocked)
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
        onAuthExpired={() => { setUser(null); setViewingSession(null) }}
      />
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <PanelHeader
        user={user}
        isEmbed={false}
        enabled={enabled}
        onToggleEnabled={onToggleEnabled}
        onClose={onClose}
        onLogout={onLogout}
      />
      <QuotaBanner user={user} quota={quota} blocked={quotaBlocked} onUpgrade={onUpgrade} />
      <div className="px-3 pt-3 pb-2 text-xs text-gray-600 leading-relaxed border-b border-gray-200">
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
        onAuthExpired={() => setUser(null)}
        onView={setViewingSession}
      />
    </div>
  )
}
