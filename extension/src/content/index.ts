import { mountInlineButton, type InlineButtonHandle, type InlineButtonState } from './inline-button'
import { mountModal } from './in-page-modal'
import { AudioCapture, blobToBase64 } from './audio-capture'
import { SlideDetector, type Slide } from './slide-detector'
import { getEnabled } from '../shared/storage'
import type { QuotaSnapshot } from '../shared/types'
import { CURATE_URL } from '../shared/config'

// This script runs in the top frame AND in every iframe (manifest has all_frames: true).
// Different platforms embed the <video> element in different places:
//   - YouTube, Coursera (some): top frame
//   - K-LMS, Canvas Studio, Vimeo embeds: cross-origin iframe
// We let each frame independently look for a video and mount the inline button
// in WHATEVER frame contains the video. The modal must be mounted in the TOP
// frame, however, because it's a viewport-level overlay (an iframe is too small).
// Cross-frame coordination uses window.postMessage:
//   iframe → parent (top): { source: 'sh-frame', type: 'REQUEST_MODAL' | 'STOPPED' }
//   parent (top) → iframe: { source: 'sh-parent', type: 'MODAL_CLOSED' | 'SET_SPEED' | 'STOP_CAPTURE' }
const isTopFrame = window.top === window.self

// Idempotence sentinel against content-script re-injection. SPA
// navigations inside the same tab can cause Chrome to re-run the
// content script without unloading the prior copy. Without a guard
// every module-level addEventListener stacks, producing multiplicative
// event handling (one chrome.runtime message → N copies fire) and
// growing memory each time.
//
// We tag the frame's window with a sentinel and gate listener
// registration on it. State vars (activeVideo, capture, etc.) are fine
// to re-declare — they live in the new module's closure — but window-
// level event listeners are global and need to dedupe.
interface ShWindow extends Window { __SH_CONTENT_BOOTED__?: true }
const __sh_first_boot__ = !(window as unknown as ShWindow).__SH_CONTENT_BOOTED__
;(window as unknown as ShWindow).__SH_CONTENT_BOOTED__ = true

let detected = false
let activeVideo: HTMLVideoElement | null = null
let button: InlineButtonHandle | null = null
let capture: AudioCapture | null = null
let detector: SlideDetector | null = null
let onEndedHandler: (() => void) | null = null
// Tracks the in-flight capture session so stopCaptureLocal can flip a flag
// that the AudioCapture / SlideDetector callbacks read, suppressing any
// straggler chunks produced after stop().
type CaptureSession = { id: string; canonicalAdopted: boolean; stopped: boolean }
let activeSession: CaptureSession | null = null
// Cleanup callback set by startCapture and invoked by stopCaptureLocal
// to detach the early play/pause listeners attached before the await
// boundary. Without this they leak across stop/restart cycles and
// rebroadcast video state when the user has actually stopped capture.
let captureCleanup: (() => void) | null = null

function setButtonStatus(s: InlineButtonState): void {
  button?.setStatus(s)
}

// Robust video detection.
// - width threshold lowered to 100 (small embedded players still count)
// - intrinsic videoWidth/Height fallback when bounding rect is momentarily 0
//   (the metadata loaded before the layout settled)
function findBestVideo(): HTMLVideoElement | null {
  const all = Array.from(document.querySelectorAll<HTMLVideoElement>('video'))
  let best: HTMLVideoElement | null = null
  let bestScore = 0
  for (const v of all) {
    const r = v.getBoundingClientRect()
    const rectArea = r.width * r.height
    const intrinsicArea = v.videoWidth * v.videoHeight
    // Take whichever is larger; intrinsic is weighted lower since it doesn't
    // reflect visible size.
    const score = Math.max(rectArea, intrinsicArea / 4)
    const passes = r.width > 100 || v.videoWidth > 0
    if (score > bestScore && passes) {
      best = v
      bestScore = score
    }
  }
  return best
}

function applySpeed(speed: number): void {
  if (activeVideo) activeVideo.playbackRate = speed
}

function onModalClosed(): void {
  setButtonStatus(capture !== null ? 'processing' : 'idle')
}

function broadcastToFrames(message: unknown): void {
  const iframes = document.querySelectorAll<HTMLIFrameElement>('iframe')
  iframes.forEach(ifr => {
    try { ifr.contentWindow?.postMessage(message, '*') } catch { /* ignore */ }
  })
}

function handleActivate(): void {
  console.log(`[SH:${isTopFrame ? 'top' : 'iframe'}]`, location.host, 'handleActivate')
  // Synchronously tell the modal "we've started, audio is being collected,
  // first transcript arrives in a few seconds". Without this the modal
  // sits in its initial empty state until the canonical session id arrives
  // (~13-18 s on a cold-start path), so users perceive the click as
  // unresponsive. Fired BEFORE the modal even mounts so the React app
  // sees it on first render via the SP_BROADCAST channel.
  chrome.runtime.sendMessage({
    type: 'SP_BROADCAST',
    payload: { type: 'session_pending' },
  })
  if (isTopFrame) {
    // Direct flow — modal in same frame, capture in same frame
    mountModal({
      onClose: () => {
        // Tell child iframes too (defensive — capture may live there)
        broadcastToFrames({ source: 'sh-parent', type: 'MODAL_CLOSED' })
        onModalClosed()
      },
      onSetSpeed: (speed: number) => {
        applySpeed(speed)
        broadcastToFrames({ source: 'sh-parent', type: 'SET_SPEED', speed })
      },
      parentUrl: location.href,
    })
    setButtonStatus('hidden')
    void startCapture(location.href)
  } else {
    // Iframe: ask the parent (top frame) to mount the modal; capture stays here
    // (we have the <video> element in this frame).
    window.parent.postMessage(
      { source: 'sh-frame', type: 'REQUEST_MODAL', frameUrl: location.href },
      '*',
    )
    setButtonStatus('hidden')
    void startCapture(location.href)
  }
}

function tryMountButton(): void {
  if (detected) return
  const v = findBestVideo()
  if (!v) return
  detected = true
  activeVideo = v
  console.log(`[SH:${isTopFrame ? 'top' : 'iframe'}]`, location.host, 'video found, mounting button', { rectW: v.getBoundingClientRect().width, rectH: v.getBoundingClientRect().height, videoW: v.videoWidth, videoH: v.videoHeight })
  button = mountInlineButton(v, () => { handleActivate() }, () => stopCaptureLocal())
  // Pre-warm the Lambdas the user is about to hit. Fire-and-forget; the
  // SW's WARMUP handler dispatches pings to /v1/auth/google, /v1/session,
  // and /v1/stream/audio in parallel. Best case: shaves ~2 s off the first
  // backend call. Worst case: a few extra HTTP requests no one cares about.
  void chrome.runtime.sendMessage({ type: 'WARMUP' }).catch(() => { /* ignore */ })
}

function unmountButton(): void {
  button?.unmount()
  button = null
  detected = false
}

function setupMutationObserver(): void {
  let mutationDebounce = 0
  const obs = new MutationObserver((mutations) => {
    if (detected) { obs.disconnect(); return }
    const now = Date.now()
    if (now - mutationDebounce >= 500) {
      mutationDebounce = now
      tryMountButton()
    }
    // Attach loadedmetadata listener to dynamically-added video elements so we
    // re-try mounting once the video is actually playable. Some sites (esp.
    // SPA-style players) add the <video> with 0 size and only populate
    // dimensions after metadata loads.
    for (const m of mutations) {
      m.addedNodes.forEach(node => {
        if (node instanceof HTMLVideoElement) {
          node.addEventListener('loadedmetadata', () => tryMountButton(), { once: true })
        } else if (node instanceof HTMLElement) {
          node.querySelectorAll('video').forEach(v => {
            v.addEventListener('loadedmetadata', () => tryMountButton(), { once: true })
          })
        }
      })
    }
  })
  obs.observe(document.documentElement, { childList: true, subtree: true })
}

function init(): void {
  void (async () => {
    const enabled = await getEnabled()
    if (!enabled) return

    tryMountButton()
    setupMutationObserver()
    maybeSeekFromUrl()

    // Periodic poll for the first 30s — covers sites that don't fire mutations
    // when adding the video (shadow DOM patterns, deferred element insertion,
    // etc.). Stops as soon as we mount, or after 15 polls.
    let polls = 0
    const pollId = window.setInterval(() => {
      polls += 1
      if (detected || polls >= 15) {
        window.clearInterval(pollId)
        return
      }
      tryMountButton()
    }, 2000)
  })()
}

// Auto-seek from `__sh_seek=<seconds>` URL param. Markdown-obsidian's
// deepLink() emits this alongside the standard `t=NNs` so timestamp
// links land at the right time on platforms whose player ignores
// `t=` (K-LMS, Canvas Studio, Kaltura, etc.) — verified empirically
// that K-LMS rejects every standard timestamp param convention.
//
// We poll for the video to be ready (loadedmetadata) and seek when
// it is, with a 15 s ceiling so we stop even if the page never
// produces a video. Only acts on iframes / pages that actually
// contain a <video>; the param itself is harmless on other pages.
function maybeSeekFromUrl(): void {
  const seekParam = new URLSearchParams(location.search).get('__sh_seek')
  if (!seekParam) return
  const targetSec = parseFloat(seekParam)
  if (!isFinite(targetSec) || targetSec < 0) return

  let attempts = 0
  const MAX_ATTEMPTS = 30   // 30 × 500 ms = 15 s
  const id = window.setInterval(() => {
    attempts++
    const v = findBestVideo()
    if (v && v.readyState >= 2) {
      try {
        v.currentTime = targetSec
        // eslint-disable-next-line no-console
        console.log(`[SH:seek] jumped to ${targetSec}s via __sh_seek param`)
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[SH:seek] currentTime assignment threw', e)
      }
      // Best-effort autoplay — most browsers block autoplay for
      // videos with audio when the user hasn't interacted with the
      // page yet. The catch is intentional: if blocked, the user
      // sees the video paused at the right timestamp and can hit
      // play themselves. Better than starting at 0:00.
      if (v.paused) v.play().catch(() => { /* autoplay policy */ })
      window.clearInterval(id)
    } else if (attempts >= MAX_ATTEMPTS) {
      window.clearInterval(id)
      // eslint-disable-next-line no-console
      console.warn(`[SH:seek] gave up after ${MAX_ATTEMPTS} attempts — no playable video`)
    }
  }, 500)
}

// Gate init() too — it sets up a MutationObserver and a 30 s polling
// interval. On content-script re-injection (SPA navigation in the same
// document), running init() again would stack a second observer that
// fires on every DOM mutation in addition to the original, eventually
// O(N) observers per long-lived tab.
if (__sh_first_boot__) init()

// ===== Cross-frame message routing =====
// All addEventListener / chrome.runtime.onMessage / chrome.storage.onChanged
// calls below are gated behind __sh_first_boot__ so they do not duplicate
// when Chrome re-injects this content script into the same frame (e.g.
// after an SPA navigation that doesn't reload the document).

if (__sh_first_boot__ && isTopFrame) {
  // Receive messages from child iframes (e.g. iframe asks us to mount the modal).
  window.addEventListener('message', (e: MessageEvent) => {
    const data = e.data as { source?: string; type?: string; frameUrl?: string } | null
    if (!data || data.source !== 'sh-frame') return

    if (data.type === 'REQUEST_MODAL') {
      mountModal({
        onClose: () => {
          broadcastToFrames({ source: 'sh-parent', type: 'MODAL_CLOSED' })
          onModalClosed()
        },
        onSetSpeed: (speed: number) => {
          // Apply locally (no-op if no video here) AND broadcast to children
          applySpeed(speed)
          broadcastToFrames({ source: 'sh-parent', type: 'SET_SPEED', speed })
        },
        // Use the iframe's URL so the modal queries /v1/session with the
        // SAME url that the capture frame uploaded chunks under. Falling
        // back to location.href (the top frame's URL) breaks markdown
        // export with 404 on K-LMS / Vimeo / Canvas Studio because the
        // url_hash differs from what stream-audio inserted.
        parentUrl: data.frameUrl,
      })
    }
    // 'STOPPED' from a child is informational — modal stays open until user
    // closes it. Notes are already saved server-side. No-op for now.
  })

  // Modal-originated control messages (JUMP_TO, TRIGGER_CURATE). The
  // modal lives as an iframe inside this top frame and posts to
  // window.parent (= here). On YouTube the video is in this frame too,
  // so the listeners registered inside startCapture pick the message
  // up directly. On K-LMS / Vimeo the video is in a child iframe; we
  // need to forward the message there. Doing both unconditionally is
  // safe — only the frame that actually has activeVideo / capture
  // state will act on it.
  window.addEventListener('message', (e: MessageEvent) => {
    const data = e.data as { source?: string; type?: string; ts?: number; full?: boolean; play?: boolean } | null
    if (!data || data.source !== 'sh-parent') return
    if (data.type === 'JUMP_TO' && typeof data.ts === 'number') {
      if (activeVideo) activeVideo.currentTime = data.ts
      broadcastToFrames(data)
    } else if (data.type === 'TRIGGER_CURATE') {
      broadcastToFrames(data)
    } else if (data.type === 'SET_PLAY' && typeof data.play === 'boolean') {
      // Modal-originated play/pause toggle. Apply locally if the video
      // lives in the top frame, AND fan out to children since the
      // <video> may be in a child iframe (K-LMS, Vimeo, etc).
      if (activeVideo) {
        if (data.play) void activeVideo.play().catch(() => { /* ignore */ })
        else activeVideo.pause()
      }
      broadcastToFrames(data)
    }
  })
} else if (__sh_first_boot__) {
  // Iframe: receive directives from the top frame.
  window.addEventListener('message', (e: MessageEvent) => {
    const data = e.data as { source?: string; type?: string; speed?: number; ts?: number; play?: boolean } | null
    if (!data || data.source !== 'sh-parent') return

    if (data.type === 'MODAL_CLOSED') {
      onModalClosed()
    } else if (data.type === 'SET_SPEED' && typeof data.speed === 'number') {
      applySpeed(data.speed)
    } else if (data.type === 'STOP_CAPTURE') {
      stopCaptureLocal()
    } else if (data.type === 'JUMP_TO' && typeof data.ts === 'number') {
      // Top frame relays modal jump requests here. Only the frame with
      // the actual <video> acts (others have activeVideo === null).
      if (activeVideo) activeVideo.currentTime = data.ts
    } else if (data.type === 'SET_PLAY' && typeof data.play === 'boolean') {
      // Top frame relays modal play/pause toggles here. Only the frame
      // with the actual <video> acts; siblings without it are no-ops.
      if (activeVideo) {
        if (data.play) void activeVideo.play().catch(() => { /* ignore */ })
        else activeVideo.pause()
      }
    }
  })
}

// ===== Storage / runtime message routing (existing) =====

if (__sh_first_boot__) {
// React to ON/OFF changes broadcast by the SW.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'SH_ENABLED_CHANGED') {
    if (msg.enabled) {
      tryMountButton()
    } else {
      unmountButton()
      // Do NOT stop an in-flight session here; the OFF toggle just hides the
      // affordance. Stop is an explicit user action via the side panel / pill.
    }
    sendResponse({ ok: true })
    return true
  }
  return false
})

// Also react to direct storage changes (e.g. options page toggling state).
chrome.storage?.onChanged.addListener((changes, area) => {
  if (area !== 'local') return
  const c = changes['sh.enabled']
  if (!c) return
  const enabled = c.newValue !== false
  if (enabled) tryMountButton()
  else unmountButton()
})

chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
  if (msg?.type === 'JUMP_TO') {
    // Side-panel-originated jumps arrive here via the SW's tabs.sendMessage.
    // Only the top frame receives it (chrome.tabs.sendMessage delivers to
    // the top frame by default). Forward to children iframes too because
    // the video may live in one of them (K-LMS, Vimeo).
    //
    // Note: we deliberately do NOT touch playbackRate here. The previous
    // implementation reset it to 1.0 on every jump, which yanked users
    // out of their chosen 2× / 1.5× playback. The user's speed setting
    // is its own concern — a jump shouldn't override it.
    if (activeVideo) activeVideo.currentTime = msg.ts
    if (isTopFrame) {
      broadcastToFrames({ source: 'sh-parent', type: 'JUMP_TO', ts: msg.ts })
    }
    sendResponse({ ok: true })
    return true
  }
  if (msg?.type === 'STOP_SESSION') {
    // Stop locally (no-op if capture is in a child iframe) AND fan out to
    // child iframes so the frame that actually has the video stops too.
    stopCaptureLocal()
    if (isTopFrame) {
      broadcastToFrames({ source: 'sh-parent', type: 'STOP_CAPTURE' })
    }
    sendResponse({ ok: true })
    return true
  }
  return false
})

}  // end if (__sh_first_boot__)

function stopCaptureLocal(): void {
  // Run the wrap-up handler — pauses the underlying <video>, runs the
  // final curate, broadcasts session_ended, and detaches every per-
  // session listener that the closure registered. Calling this from
  // user-stop makes the modal's 停止 button equivalent to the natural-
  // end path (the user wants the notes now, just like ended-of-video).
  // session.stopped guard inside onEndedHandler makes it idempotent.
  if (onEndedHandler) {
    try {
      // Detach the 'ended' listener BEFORE invoking, so a later
      // 'ended' fire (the user might keep playing the video to the
      // end after they've already stopped) doesn't re-run wrap-up.
      if (activeVideo) activeVideo.removeEventListener('ended', onEndedHandler)
      onEndedHandler()
    } catch (e) { warn('onEndedHandler threw', e) }
    onEndedHandler = null
  } else {
    // No wrap-up handler set (capture never started, or already torn
    // down). Defensive cleanup of capture/detector if somehow lingering.
    if (activeSession) activeSession.stopped = true
    try { capture?.stop() } catch { /* ignore */ }
    try { detector?.stop() } catch { /* ignore */ }
  }
  capture = null
  detector = null
  activeSession = null
  if (captureCleanup) {
    try { captureCleanup() } catch { /* ignore */ }
    captureCleanup = null
  }
  // Notes preserved server-side; revert button so the user can re-engage.
  setButtonStatus('idle')
}

// Diagnostic logger — prefixed so we can grep in the console regardless of
// which frame logged. Frame URL is included so it's clear whether the iframe
// or top frame produced the line.
const TAG = `[SH:${isTopFrame ? 'top' : 'iframe'}]`
function log(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log(TAG, location.host, ...args)
}
function warn(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.warn(TAG, location.host, ...args)
}

async function startCapture(url: string): Promise<void> {
  if (!activeVideo) { warn('startCapture: no activeVideo'); return }
  if (activeVideo.readyState < 2) { warn('startCapture: video readyState<2'); return }
  // Already capturing? Skip.
  if (capture) { log('startCapture: already capturing'); return }

  log('startCapture: starting', { url, readyState: activeVideo.readyState, paused: activeVideo.paused })

  // ── Push initial video state IMMEDIATELY (synchronous) ─────────────
  // The modal renders the "録音中 / 停止中" pill from this signal. Doing
  // it here (before the awaited storage read, before the AudioContext
  // construction, before the listeners) closes a window where the user
  // could press play and see no UI feedback for hundreds of ms. The
  // play/pause listeners are attached at the very next sync line so
  // any subsequent state change is captured too.
  const earlyVideoStateMessage = (playing: boolean) => ({
    type: 'SP_BROADCAST',
    payload: { type: 'video_state', playing },
  })
  chrome.runtime.sendMessage(earlyVideoStateMessage(!activeVideo.paused))
  broadcastToFrames({ source: 'sh-frame', type: 'VIDEO_STATE', playing: !activeVideo.paused })

  // Attach play/pause listeners IMMEDIATELY too — before the async
  // storage read. If the user presses play during the await window we
  // would otherwise miss the event entirely. We attach a thin proxy
  // here that just rebroadcasts state; the curate-trigger listeners
  // are attached later (after capture is up) and are independent.
  const earlyOnPlay = () => {
    chrome.runtime.sendMessage(earlyVideoStateMessage(true))
    broadcastToFrames({ source: 'sh-frame', type: 'VIDEO_STATE', playing: true })
  }
  const earlyOnPause = () => {
    chrome.runtime.sendMessage(earlyVideoStateMessage(false))
    broadcastToFrames({ source: 'sh-frame', type: 'VIDEO_STATE', playing: false })
  }
  activeVideo.addEventListener('play', earlyOnPlay)
  activeVideo.addEventListener('pause', earlyOnPause)
  // Register a cleanup so stopCaptureLocal() can detach these even
  // when the natural ended/onEndedHandler path doesn't fire.
  captureCleanup = () => {
    activeVideo?.removeEventListener('play', earlyOnPlay)
    activeVideo?.removeEventListener('pause', earlyOnPause)
  }

  // Apply configured playback speed (or default).
  const stored = await chrome.storage.local.get('sh.playback')
  const speed = stored['sh.playback']
  if (speed === 'auto' || speed === undefined) {
    activeVideo.playbackRate = detectMaxSpeed(activeVideo) ?? 2
  } else if (typeof speed === 'number') {
    activeVideo.playbackRate = speed
  }

  // Tentative client-generated id; backend MAY return a different canonical id
  // on the first /v1/stream/audio response. Adopt that canonical id and only
  // THEN broadcast session_started so the modal connects WS to the correct
  // session.
  //
  // RACE NOTE: We deliberately keep the session id in a closure (`session`)
  // rather than re-reading any module-level session id from inside the
  // AudioCapture callback. After the user presses stop, stopCaptureLocal()
  // would clear such a module variable, but MediaRecorder may still emit one
  // last "drain" chunk via onstop AFTER that nulling. If the callback read
  // the module variable, that drain chunk would POST `session_id: null` and
  // the backend's Zod validator would 400. Holding the id in a closure scopes
  // it correctly to this capture session only.
  const session: {
    id: string
    canonicalAdopted: boolean
    stopped: boolean
    // Slides emitted before the canonical session id arrives. Holding
    // them here (instead of dropping) preserves the very first slide —
    // SlideDetector's forced-baseline emit fires at ~2 s after capture
    // start, while the canonical id arrives only after the first audio
    // chunk completes its STT round-trip (~3-4 s). Without this queue
    // the opening slide of every lecture is silently lost.
    pendingSlides: Slide[]
  } = {
    id: crypto.randomUUID(),
    canonicalAdopted: false,
    stopped: false,
    pendingSlides: [],
  }
  let chunksSent = 0

  try {
    capture = new AudioCapture(activeVideo, async (chunk) => {
      // After stopCaptureLocal() flips the flag, drop any straggler chunk
      // produced by MediaRecorder's drain rather than POSTing with a stale id.
      if (session.stopped) { log('audio chunk dropped (session stopped)'); return }
      chunksSent += 1
      log('audio chunk produced', { n: chunksSent, durationSec: chunk.durationSec, blobSize: chunk.blob.size, mime: chunk.mime })
      const b64 = await blobToBase64(chunk.blob)
      type ChunkOk = {
        ok: true
        data: {
          added?: number
          transcript_preview?: string
          session_id: string
          quota?: QuotaSnapshot
          chunk_error?: string
        }
      }
      type ChunkErr = { ok: false; error: string; status?: number; data?: { error?: string; quota?: QuotaSnapshot } }
      // Single retry with 1.5s backoff for transient 5xx. Observed in
      // production: API Gateway → VPC Lambda occasionally returns 503
      // even though the Lambda itself succeeds (CloudWatch shows clean
      // invocations). About 1 in 5 chunks affected on cold-network
      // moments. A single retry recovers virtually all of them and the
      // delay is hidden inside the 10 s chunk cadence.
      const sendChunk = async (): Promise<ChunkOk | ChunkErr | undefined> => {
        return await chrome.runtime.sendMessage({
          type: 'API_FETCH',
          method: 'POST',
          path: '/v1/stream/audio',
          body: {
            session_id: session.id,
            url,
            start_time_sec: chunk.startTimeSec,
            duration_sec: chunk.durationSec,
            audio_b64: b64,
            mime: chunk.mime,
          },
        }) as ChunkOk | ChunkErr | undefined
      }
      const isTransient5xx = (resp: typeof r): boolean =>
        !!resp && !resp.ok && typeof resp.status === 'number' && resp.status >= 500 && resp.status < 600
      let r: ChunkOk | ChunkErr | undefined
      try {
        r = await sendChunk()
        if (isTransient5xx(r)) {
          warn('audio chunk: transient 5xx, retrying once', { status: (r as ChunkErr).status, n: chunksSent })
          await new Promise(res => setTimeout(res, 1500))
          if (session.stopped) return
          r = await sendChunk()
        }
      } catch (e) {
        warn('audio chunk sendMessage threw', e)
        return
      }

      if (!r) { warn('audio chunk: empty response'); return }

      if (!r.ok) {
        warn('audio chunk: backend error', r.error)
        // 402 = quota exceeded. Pull the quota snapshot the backend embeds
        // in the body, push it to the modal as a blocking banner, and stop
        // capture cleanly — there's no point burning bandwidth on chunks the
        // backend will reject for the rest of the period.
        if (r.status === 402 && r.data?.error === 'quota_exceeded' && r.data.quota) {
          chrome.runtime.sendMessage({
            type: 'SP_BROADCAST',
            payload: { type: 'quota_exceeded', quota: r.data.quota },
          })
          broadcastToFrames({ source: 'sh-frame', type: 'QUOTA_EXCEEDED', quota: r.data.quota })
          stopCaptureLocal()
        }
        return
      }
      log('audio chunk: backend ok', { added: r.data?.added, preview: r.data?.transcript_preview, canonicalSessionId: r.data?.session_id })

      if (!session.canonicalAdopted) {
        const canonical = r.data?.session_id
        if (canonical) {
          session.id = canonical
          session.canonicalAdopted = true
          log('canonical session adopted, broadcasting session_started', canonical)
          chrome.runtime.sendMessage({
            type: 'SP_BROADCAST',
            payload: { type: 'session_started', sessionId: canonical, url },
          })
          // Flush any slides emitted before the canonical id was adopted
          // (forced-baseline emit fires at ~2 s, but the canonical id
          // arrives only after this first audio chunk completes its STT
          // round-trip). Drain in order so timestamps stay monotonic.
          if (session.pendingSlides.length > 0) {
            const drain = session.pendingSlides.splice(0)
            log('flushing pre-adoption slides', { count: drain.length })
            for (const queued of drain) {
              void postSlide(queued)
            }
          }
        }
      }

      // Forward the latest quota snapshot to the modal on every chunk so
      // the banner reflects current usage in near-real-time. The modal uses
      // this to escalate from silent → 50% subtle → 80% amber → 95% orange
      // → 100% blocking. Sent both via SW broadcast (side-panel UI) and
      // via in-page postMessage (embed iframe modal).
      if (r.data?.quota) {
        chrome.runtime.sendMessage({
          type: 'SP_BROADCAST',
          payload: { type: 'quota_update', quota: r.data.quota },
        })
        broadcastToFrames({ source: 'sh-frame', type: 'QUOTA_UPDATE', quota: r.data.quota })
      }
    })
    capture.start()
    activeSession = session
    log('AudioCapture started OK')
  } catch (e) {
    warn('AudioCapture failed to start', e)
    capture = null
    return
  }

  // Slide POST extracted so the audio-chunk path can flush queued slides
  // through the same code path after canonical-id adoption.
  const postSlide = async (slide: Slide): Promise<void> => {
    if (session.stopped) {
      log('slide dropped (session stopped)', { ts: slide.ts.toFixed(1) })
      return
    }
    const buf = await slide.blob.arrayBuffer()
    let s = ''; const bytes = new Uint8Array(buf)
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
    const b64 = btoa(s)
    log('slide → POST /v1/stream/slide', { ts: slide.ts.toFixed(1), bytes: slide.blob.size })
    const r = await chrome.runtime.sendMessage({
      type: 'API_FETCH',
      method: 'POST',
      path: '/v1/stream/slide',
      // `url` is required by the backend's Zod validator — same shape as
      // /v1/stream/audio. Omitting it produced a 500 (ZodError surfaced
      // as Internal Server Error) on every slide upload.
      body: { session_id: session.id, url, ts: slide.ts, image_b64: b64, mime: 'image/jpeg' },
    }) as { ok: boolean; error?: string; status?: number } | null
    if (!r) warn('slide POST: empty response')
    else if (!r.ok) warn('slide POST failed', { status: r.status, error: r.error })
    else log('slide POST ok', { ts: slide.ts.toFixed(1) })
  }

  detector = new SlideDetector(activeVideo, async (slide: Slide) => {
    if (session.stopped) {
      log('slide dropped (session stopped)', { ts: slide.ts.toFixed(1) })
      return
    }
    if (!session.canonicalAdopted) {
      // Queue rather than drop. The audio-chunk handler flushes this
      // queue right after it adopts the canonical session id.
      session.pendingSlides.push(slide)
      log('slide queued (waiting for canonical session id)', { ts: slide.ts.toFixed(1), queued: session.pendingSlides.length })
      return
    }
    await postSlide(slide)
  })
  detector.start()
  log('SlideDetector started — first emit can only happen after baseline frame + change')

  // ── Phase 6.1: on-demand curator triggers ──────────────────────────────
  // The curator is no longer driven by stream-audio (rolling). It runs
  // on demand when the user signals "I'm pausing — give me notes":
  //   - pause event after 3 s of remaining paused (debounce — short
  //     scrub-pauses or scrub-back shouldn't fire the curator)
  //   - ended event (video finished naturally)
  //   - the modal's manual "📝 ノートを生成" button (sent via window
  //     postMessage from the iframe → see SH_TRIGGER_CURATE handler)
  //
  // Each trigger calls POST /v1/session/curate which reads the full
  // transcript log and (re)writes the outline, then broadcasts via WS.
  let curateInFlight = false

  const triggerCurate = (reason: string): void => {
    if (!session.canonicalAdopted) return       // no session yet — nothing to curate
    if (curateInFlight) return                  // dedupe overlapping requests
    curateInFlight = true
    log('triggering curate', { reason, sessionId: session.id })
    // The modal is the user-facing surface — tell it we're curating so
    // it can swap to a "ノート生成中…" state. The modal receives this
    // via window.postMessage from this content frame.
    broadcastToFrames({ source: 'sh-frame', type: 'CURATING', reason })
    chrome.runtime.sendMessage({
      type: 'API_FETCH',
      method: 'POST',
      // Lambda Function URL bypasses API Gateway HTTP API's hard 30 s
      // integration timeout — the curator can take 50–90 s on long
      // transcripts. When CURATE_URL isn't set (dev / older builds) we
      // fall through to the API GW route, which still works for short
      // sessions but will 503 on long ones.
      path: '/v1/session/curate',
      absoluteUrl: CURATE_URL || undefined,
      body: { session_id: session.id, full_rewrite: reason === 'manual_full' },
    }).then((r: unknown) => {
      const resp = r as { ok: boolean; data?: { outline?: unknown; reason?: string }; error?: string } | null
      const ok = !!resp?.ok
      log('curate done', { reason, ok, hasOutline: !!resp?.data?.outline, error: resp?.error })
      // Fallback path: WS broadcast can be lost if the connection dropped
      // during the long curator wait (cold-start LLM calls take 30-70 s,
      // long enough for an idle WS to be reaped). Push the outline directly
      // to the modal here too — the modal's onOutline handler is idempotent
      // (replaces state with the latest outline) so duplicate delivery is
      // harmless. This guarantees the user never sits in an infinite
      // "ノート生成中…" state when the curator actually succeeded.
      if (ok && resp?.data?.outline) {
        chrome.runtime.sendMessage({
          type: 'SP_BROADCAST',
          payload: { type: 'outline_updated', outline: resp.data.outline },
        })
        broadcastToFrames({ source: 'sh-frame', type: 'OUTLINE_UPDATED', outline: resp.data.outline })
      } else if (!ok || resp?.data?.reason === 'no_transcripts_yet') {
        // Tell the modal to come out of the spinner state with a useful
        // message instead of hanging forever.
        const reason = resp?.data?.reason ?? resp?.error ?? 'unknown'
        chrome.runtime.sendMessage({
          type: 'SP_BROADCAST',
          payload: { type: 'curate_failed', reason },
        })
        broadcastToFrames({ source: 'sh-frame', type: 'CURATE_FAILED', reason })
      }
    }).catch(e => {
      warn('curate request failed', e)
      const reason = e instanceof Error ? e.message : 'request_failed'
      chrome.runtime.sendMessage({
        type: 'SP_BROADCAST',
        payload: { type: 'curate_failed', reason },
      })
      broadcastToFrames({ source: 'sh-frame', type: 'CURATE_FAILED', reason })
    }).finally(() => { curateInFlight = false })
  }

  // Note generation is now EXPLICIT-ONLY:
  //   - User clicks "📝 ノートを再生成" in the modal → TRIGGER_CURATE
  //   - Session ends (natural <video> ended OR ✕ 終了) → triggerCurate('ended')
  // The previous pause-debounce trigger ("video paused for 3 s → curate")
  // was removed because users found it surprising — they'd press spacebar
  // to take a sip of water and a curator run would fire silently in the
  // background, costing a /v1/session/curate roundtrip and (on free tier)
  // burning the 30 s cooldown for the next deliberate manual click.
  //
  // Listen for manual trigger from the modal (postMessage).
  const onManualTrigger = (e: MessageEvent): void => {
    const data = e.data as { source?: string; type?: string; full?: boolean } | null
    if (!data || data.source !== 'sh-parent') return
    if (data.type === 'TRIGGER_CURATE') {
      triggerCurate(data.full ? 'manual_full' : 'manual')
    }
  }
  window.addEventListener('message', onManualTrigger)

  // Wrap-up handler — called from BOTH the natural-end path (<video>'s
  // 'ended' event) and the user-stop path (stopCaptureLocal). Idempotent
  // via session.stopped guard so calling it twice is a no-op.
  //
  // Always pauses the video first so the user explicitly sees the
  // session as wrapped up — important for the user-stop path because
  // the user's intent in clicking 停止 is "I'm done with this lecture".
  onEndedHandler = () => {
    if (session.stopped) return                  // idempotence
    try { activeVideo?.pause() } catch { /* ignore */ }
    session.stopped = true
    detector?.stop()
    capture?.stop()
    activeVideo?.removeEventListener('play', earlyOnPlay)
    activeVideo?.removeEventListener('pause', earlyOnPause)
    window.removeEventListener('message', onManualTrigger)
    if (session.canonicalAdopted) {
      // Final curate produces the wrap-up outline from everything we
      // captured. Same trigger for both natural-end and user-stop —
      // the user's intent in either case is "give me the notes now".
      triggerCurate('ended')
      // Broadcast a session_ended event to the modal so the auto-
      // download path (if user opted in via Options) can fire its
      // zip export as soon as the final outline arrives. Both the
      // SP_BROADCAST channel (side-panel mode) and the in-page
      // postMessage channel (embed mode) are used.
      chrome.runtime.sendMessage({
        type: 'SP_BROADCAST',
        payload: { type: 'session_ended', sessionId: session.id },
      })
      broadcastToFrames({ source: 'sh-frame', type: 'SESSION_ENDED', sessionId: session.id })
    }
    setButtonStatus('idle')
  }
  activeVideo.addEventListener('ended', onEndedHandler)
}

function detectMaxSpeed(_v: HTMLVideoElement): number | null {
  return 2
}

export {}  // module marker
